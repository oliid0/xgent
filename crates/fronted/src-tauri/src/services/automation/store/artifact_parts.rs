use std::io::{Read, Seek, SeekFrom, Error, ErrorKind};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use super::*;

pub(crate) const MAX_STREAM_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const ARTIFACT_CHUNK_BYTES: usize = 256 * 1024;
const PART_BYTES: usize = 512 * 1024;

/// Same transaction owns the manifest and all pieces. No partial publication.
pub(super) fn write_snapshot(conn: &Connection, execution: &str, path: &str,
    bytes: u64, expected_hash: Option<&str>, reader: &mut impl Read) -> Result<BackgroundArtifact,String> {
    if bytes > MAX_STREAM_ARTIFACT_BYTES {return Err("Artifact exceeds 512 MiB".into());}
    let (count,total):(u32,u64)=conn.query_row("SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM automation_background_artifacts WHERE execution_id=?1",
        params![execution],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
    if count>=32 || total.checked_add(bytes).is_none_or(|sum|sum>1024*1024*1024) {return Err("Artifact quota exceeded (32 files / 1 GiB)".into());}
    let id=Uuid::new_v4().to_string();
    conn.execute("INSERT INTO automation_background_artifacts (artifact_id,execution_id,relative_path,content_hash,bytes,content,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id,execution,path,"0".repeat(64),bytes,Vec::<u8>::new(),db::now_ms()]).map_err(|e|e.to_string())?;
    // Small asynchronous media still uses the historical whole-file reader.
    if bytes<=8*1024*1024 {
        let mut data=vec![0;bytes as usize];reader.read_exact(&mut data).map_err(|e|e.to_string())?;
        if reader.read(&mut [0u8;1]).map_err(|e|e.to_string())?!=0 {return Err("Artifact size changed while reading".into());}
        let content_hash=format!("{:x}",Sha256::digest(&data));
        if expected_hash.is_some_and(|expected|expected!=content_hash) {return Err("Artifact changed after its original hash observation".into());}
        conn.execute("UPDATE automation_background_artifacts SET content=?2,content_hash=?3 WHERE artifact_id=?1",params![id,data,content_hash]).map_err(|e|e.to_string())?;
        return Ok(BackgroundArtifact {id,relative_path:path.into(),content_hash,bytes});
    }
    let mut hash=Sha256::new();let mut remaining=bytes;let mut index=0;
    while remaining>0 {
        let size=remaining.min(PART_BYTES as u64) as usize;let mut data=vec![0;size];
        reader.read_exact(&mut data).map_err(|e|e.to_string())?;hash.update(&data);
        conn.execute("INSERT INTO automation_artifact_parts (artifact_id,part_index,content,content_hash) VALUES (?1,?2,?3,?4)",
            params![id,index,data,format!("{:x}",Sha256::digest(&data))]).map_err(|e|e.to_string())?;
        index+=1;remaining-=size as u64;
    }
    if reader.read(&mut [0u8;1]).map_err(|e|e.to_string())?!=0 {return Err("Artifact size changed while reading".into());}
    let content_hash=format!("{:x}",hash.finalize());
    if expected_hash.is_some_and(|expected|expected!=content_hash) {return Err("Artifact changed after its original hash observation".into());}
    conn.execute("UPDATE automation_background_artifacts SET content_hash=?2 WHERE artifact_id=?1",
        params![id,content_hash]).map_err(|e|e.to_string())?;
    Ok(BackgroundArtifact {id,relative_path:path.into(),content_hash,bytes})
}

/// At most one piece is retained; Read/Seek permits bounded Office validation.
pub(crate) struct ArtifactReader<'a> {
    conn: &'a Connection, artifact: BackgroundArtifact, position:u64,
    cache:Vec<u8>, cached:Option<u64>, chunked:bool,
}
impl<'a> ArtifactReader<'a> {
    pub(crate) fn new(conn:&'a Connection,artifact:BackgroundArtifact) -> Result<Self,String> {
        if artifact.bytes>MAX_STREAM_ARTIFACT_BYTES {return Err("Artifact exceeds bounded stream storage".into());}
        let (length,parts):(u64,u64)=conn.query_row("SELECT length(content),(SELECT COUNT(*) FROM automation_artifact_parts p WHERE p.artifact_id=a.artifact_id) FROM automation_background_artifacts a WHERE a.artifact_id=?1",
            params![artifact.id],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
        let chunked=parts>0;
        if (chunked && (length!=0 || parts!=(artifact.bytes+PART_BYTES as u64-1)/PART_BYTES as u64))
            || (!chunked && (length!=artifact.bytes || length>8*1024*1024)) {
            return Err("Artifact storage does not match its immutable manifest".into());
        }
        Ok(Self {conn,artifact,position:0,cache:vec![],cached:None,chunked})
    }
    fn load(&mut self,index:u64) -> std::io::Result<()> {
        if self.cached==Some(index) {return Ok(());}
        let (data,hash):(Vec<u8>,String)=if self.chunked {
            self.conn.query_row("SELECT content,content_hash FROM automation_artifact_parts WHERE artifact_id=?1 AND part_index=?2 AND length(content)<=524288",
                params![self.artifact.id,index],|row|Ok((row.get(0)?,row.get(1)?)))
        } else {
            self.conn.query_row("SELECT content,content_hash FROM automation_background_artifacts WHERE artifact_id=?1 AND length(content)<=8388608",
                params![self.artifact.id],|row|Ok((row.get(0)?,row.get(1)?)))
        }.map_err(Error::other)?;
        let wanted=if self.chunked {self.artifact.bytes.saturating_sub(index*PART_BYTES as u64).min(PART_BYTES as u64)} else {self.artifact.bytes};
        if data.len() as u64!=wanted || hash!=format!("{:x}",Sha256::digest(&data)) {return Err(Error::other("Artifact piece failed integrity verification"));}
        self.cache=data;self.cached=Some(index);Ok(())
    }
    pub(crate) fn verify_hash(&mut self) -> Result<(),String> {
        self.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
        let mut hash=Sha256::new();let mut buffer=[0u8;65536];
        loop {let count=self.read(&mut buffer).map_err(|e|e.to_string())?;if count==0 {break;}hash.update(&buffer[..count]);}
        if format!("{:x}",hash.finalize())!=self.artifact.content_hash {return Err("Artifact failed whole-file integrity verification".into());}
        self.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;Ok(())
    }
}
impl Read for ArtifactReader<'_> {
    fn read(&mut self,output:&mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() || self.position>=self.artifact.bytes {return Ok(0);}
        let index=if self.chunked {self.position/PART_BYTES as u64} else {0};self.load(index)?;
        let offset=if self.chunked {(self.position%PART_BYTES as u64) as usize} else {self.position as usize};
        let count=output.len().min(self.cache.len()-offset);
        output[..count].copy_from_slice(&self.cache[offset..offset+count]);self.position+=count as u64;Ok(count)
    }
}
impl Seek for ArtifactReader<'_> {
    fn seek(&mut self,from:SeekFrom) -> std::io::Result<u64> {
        let position=match from {SeekFrom::Start(value)=>i128::from(value),SeekFrom::End(value)=>i128::from(self.artifact.bytes)+i128::from(value),SeekFrom::Current(value)=>i128::from(self.position)+i128::from(value)};
        if position<0 || position>i128::from(self.artifact.bytes) {return Err(Error::new(ErrorKind::InvalidInput,"Artifact seek exceeds its manifest"));}
        self.position=position as u64;Ok(self.position)
    }
}
impl AutomationStore {
    pub fn read_background_artifact_chunk(&self,request:&str,id:&str,offset:u64,length:usize) -> Result<BackgroundArtifactChunk,String> {
        if !(1..=ARTIFACT_CHUNK_BYTES).contains(&length) {return Err("Artifact chunk length must be 1–256 KiB".into());}
        let conn=self.lock_conn()?;
        let artifact=conn.query_row("SELECT a.artifact_id,a.relative_path,a.content_hash,a.bytes FROM automation_background_artifacts a JOIN automation_background_tasks b ON b.execution_id=a.execution_id WHERE b.request_id=?1 AND a.artifact_id=?2",
            params![request,id],|row|Ok(BackgroundArtifact {id:row.get(0)?,relative_path:row.get(1)?,content_hash:row.get(2)?,bytes:row.get(3)?})).map_err(|e|e.to_string())?;
        if offset>artifact.bytes {return Err("Artifact cursor exceeds its original manifest".into());}
        let mut reader=ArtifactReader::new(&conn,artifact.clone())?;
        reader.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;
        let mut data=vec![0;(artifact.bytes-offset).min(length as u64) as usize];
        reader.read_exact(&mut data).map_err(|e|e.to_string())?;
        let end=offset+data.len() as u64;
        Ok(BackgroundArtifactChunk {artifact,offset,chunk_hash:format!("{:x}",Sha256::digest(&data)),
            content_base64:STANDARD.encode(data),next_offset:if end<reader.artifact.bytes {Some(end)} else {None}})
    }
}
