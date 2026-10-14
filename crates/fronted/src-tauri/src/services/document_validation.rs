//! Bounded structural checks for published document evidence. These checks
//! establish readability, not factual quality or complete Office schema validity.
use std::collections::HashSet;
use std::io::{Cursor, Read, Seek};

use quick_xml::{events::Event, Reader};
use zip::ZipArchive;

const MAX_XML_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;

fn xml_root(xml: &str, expected: &str) -> Result<(), String> {
    let mut reader = Reader::from_str(xml);
    let mut stack = Vec::<Vec<u8>>::new();
    let mut root_seen = false;
    loop {
        let event = reader.read_event().map_err(|e| format!("Unreadable document XML: {e}"))?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.name().as_ref().to_vec();
                let at_root = stack.is_empty();
                let namespace_attribute = if let Some(colon) = name.iter().position(|c| *c == b':') {
                    [b"xmlns:".as_slice(), &name[..colon]].concat()
                } else { b"xmlns".to_vec() };
                let mut namespace = None;
                if stack.is_empty() {
                    if root_seen || name.rsplit(|c| *c == b':').next() != Some(expected.as_bytes()) {
                        return Err(format!("Document XML needs one {expected} root"));
                    }
                    root_seen = true;
                }
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|e| format!("Invalid document attribute: {e}"))?;
                    let value = quick_xml::escape::unescape(std::str::from_utf8(attribute.value.as_ref()).map_err(|e| e.to_string())?)
                        .map_err(|e| format!("Invalid document attribute entity: {e}"))?;
                    if at_root && attribute.key.as_ref() == namespace_attribute.as_slice() { namespace = Some(value.into_owned()); }
                }
                if at_root {
                    let accepted: &[&str] = match expected {
                        "Types" => &["http://schemas.openxmlformats.org/package/2006/content-types"],
                        "Relationships" => &["http://schemas.openxmlformats.org/package/2006/relationships"],
                        "document" => &["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
                        "presentation" | "sld" => &["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"],
                        _ => &[],
                    };
                    if !namespace.as_deref().is_some_and(|namespace| accepted.contains(&namespace)) {
                        return Err("Document XML root has an invalid Office namespace".into());
                    }
                }
                if !empty {
                    stack.push(name);
                    if stack.len() > 128 { return Err("Document XML nesting exceeds 128".into()); }
                }
            }
            Event::End(element) => {
                if stack.pop().as_deref() != Some(element.name().as_ref()) {
                    return Err("Document XML has unmatched closing elements".into());
                }
            }
            Event::Text(text) => {
                let text = std::str::from_utf8(text.as_ref()).map_err(|e| e.to_string())?;
                let text = quick_xml::escape::unescape(text).map_err(|e| e.to_string())?;
                if stack.is_empty() && !text.trim().is_empty() { return Err("Document XML has text outside its root".into()); }
            }
            Event::CData(_) if stack.is_empty() => return Err("Document XML has data outside its root".into()),
            Event::DocType(_) => return Err("Document evidence does not accept XML document types".into()),
            Event::Eof => break,
            _ => {}
        }
    }
    if !root_seen || !stack.is_empty() { return Err("Document XML has no complete root".into()); }
    Ok(())
}

fn read_part<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str, expected: &str) -> Result<(), String> {
    let mut entry = archive.by_name(name).map_err(|e| format!("Document part {name} is missing: {e}"))?;
    if entry.is_dir() || entry.size() == 0 || entry.size() > MAX_XML_BYTES {
        return Err(format!("Document part {name} is empty or exceeds 4 MiB"));
    }
    let mut bytes = Vec::new();
    (&mut entry).take(MAX_XML_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_XML_BYTES { return Err("Document XML expansion exceeds 4 MiB".into()); }
    xml_root(std::str::from_utf8(&bytes).map_err(|e| e.to_string())?, expected)
}

pub(crate) fn validate_document_artifact(path: &str, bytes: &[u8]) -> Result<(), String> {
    validate_document_reader(path, Cursor::new(bytes))
}

pub(crate) fn validate_document_reader(path: &str, mut source: impl Read + Seek) -> Result<(), String> {
    let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if extension == "pdf" {
        let mut bytes=Vec::new();(&mut source).take(MAX_PACKAGE_BYTES+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
        if bytes.len() as u64>MAX_PACKAGE_BYTES {return Err("PDF structural verification exceeds 64 MiB".into());}
        let document = lopdf::Document::load_mem(&bytes).map_err(|e| format!("Unreadable PDF evidence: {e}"))?;
        if document.get_pages().is_empty() { return Err("PDF evidence has no pages".into()); }
    } else if extension == "docx" || extension == "pptx" {
        let mut archive = ZipArchive::new(source).map_err(|e| format!("Unreadable Office evidence: {e}"))?;
        if archive.len() > 4096 { return Err("Office evidence exceeds 4096 package entries".into()); }
        let mut names = HashSet::new();
        let mut expanded = 0u64;
        for index in 0..archive.len() {
            let entry = archive.by_index(index).map_err(|e| e.to_string())?;
            if !names.insert(entry.name().to_string()) { return Err("Office evidence contains duplicate package entries".into()); }
            expanded = expanded.checked_add(entry.size()).ok_or_else(|| "Office expansion overflow".to_string())?;
            if expanded > MAX_PACKAGE_BYTES { return Err("Office evidence expansion exceeds 64 MiB".into()); }
        }
        read_part(&mut archive, "[Content_Types].xml", "Types")?;
        read_part(&mut archive, "_rels/.rels", "Relationships")?;
        if extension == "docx" {
            read_part(&mut archive, "word/document.xml", "document")?;
        } else {
            read_part(&mut archive, "ppt/presentation.xml", "presentation")?;
            let slides = names.iter().filter(|name| name.strip_prefix("ppt/slides/slide")
                .and_then(|name| name.strip_suffix(".xml")).is_some_and(|number| !number.is_empty() && number.bytes().all(|c| c.is_ascii_digit())))
                .collect::<Vec<_>>();
            if slides.is_empty() || slides.len() > 512 { return Err("Presentation evidence needs 1–512 actual slide parts".into()); }
            for slide in slides { read_part(&mut archive, slide, "sld")?; }
        }
    } else if ["doc", "ppt", "xls"].contains(&extension.as_str()) {
        return Err("Legacy binary Office evidence cannot be structurally verified; use an accepted supported format or report this limitation".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn office(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, xml) in parts {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(xml.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn office_evidence_requires_readable_actual_parts() {
        assert!(validate_document_artifact("report.pptx", b"A completed slide deck").is_err());
        let valid = office(&[("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>"), ("_rels/.rels", "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'/>"),
            ("ppt/presentation.xml", "<p:presentation xmlns:p='http://schemas.openxmlformats.org/presentationml/2006/main'/>"), ("ppt/slides/slide1.xml", "<p:sld xmlns:p='http://schemas.openxmlformats.org/presentationml/2006/main'><p:cSld/></p:sld>")]);
        assert!(validate_document_artifact("report.pptx", &valid).is_ok());
        let no_slides = office(&[("[Content_Types].xml", "<Types/>"), ("_rels/.rels", "<Relationships/>"), ("ppt/presentation.xml", "<presentation/>")]);
        assert!(validate_document_artifact("report.pptx", &no_slides).is_err());
        let malformed = office(&[("[Content_Types].xml", "<Types/>"), ("_rels/.rels", "<Relationships/>"), ("word/document.xml", "<document><body></document>")]);
        assert!(validate_document_artifact("report.docx", &malformed).is_err());
    }

    #[test]
    fn malformed_xml_and_fake_pdf_cannot_be_deliverable_proof() {
        for xml in ["<document/><document/>", "<document>", "<!DOCTYPE document><document/>", "<document bad='&madeup;'/>"] {
            assert!(xml_root(xml, "document").is_err(), "{xml}");
        }
        assert!(validate_document_artifact("report.pdf", b"%PDF-1.7\nnot a real document").is_err());
        assert!(validate_document_artifact("report.doc", b"text renamed as doc").is_err());
    }
}
