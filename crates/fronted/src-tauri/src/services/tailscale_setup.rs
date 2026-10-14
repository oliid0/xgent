//! Validated input for the sole embedded Rust engine. No process or installer path.
use serde::Deserialize;

#[derive(Clone,Copy,Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum TailscaleAuthMode { AuthKey, Oauth }

// No Debug/Serialize: credentials never become a status, log or queue record.
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TailscaleAuthInput { pub mode:TailscaleAuthMode, pub credential:String, #[serde(default)] pub tags:Vec<String> }

pub(super) fn valid_tags(tags:&[String]) -> bool {
    tags.len()<=16 && !tags.iter().any(|tag|!tag.starts_with("tag:") || tag.len()<=4 || tag.len()>64
        || !tag.as_bytes()[4].is_ascii_alphabetic()
        || !tag[4..].bytes().all(|byte|byte.is_ascii_alphanumeric() || byte==b'-'))
        && tags.iter().collect::<std::collections::BTreeSet<_>>().len()==tags.len()
}

pub(super) fn validated_credential(input:&TailscaleAuthInput) -> Result<String,String> {
    let secret=input.credential.trim();
    let prefix=match input.mode { TailscaleAuthMode::AuthKey=>"tskey-auth-",TailscaleAuthMode::Oauth=>"tskey-client-" };
    if secret.len()<=prefix.len() || secret.len()>4096 || !secret.starts_with(prefix)
        || !secret.bytes().all(|byte|byte.is_ascii_alphanumeric() || byte==b'-' || byte==b'_')
        || !valid_tags(&input.tags) {
        return Err("tailscale-invalid-input".into());
    }
    match input.mode {
        TailscaleAuthMode::Oauth if input.tags.is_empty()=>Err("tailscale-tags-required".into()),
        TailscaleAuthMode::Oauth=>Ok(secret.to_string()),
        TailscaleAuthMode::AuthKey=>Ok(secret.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tags_match_tailcfg_letter_and_ascii_rules() {
        for tag in ["tag:pc", "tag:Worker-2", "tag:a"] {
            assert!(valid_tags(&[tag.into()]));
        }
        for tag in ["tag:2pc", "tag:-pc", "tag:_pc", "tag:", "tag:a_b"] {
            assert!(!valid_tags(&[tag.into()]));
        }
        assert!(!valid_tags(&["tag:pc".into(), "tag:pc".into()]));
    }
    #[test]
    fn credentials_and_tags_are_input_only_and_never_cli_arguments() {
        let input=TailscaleAuthInput {mode:TailscaleAuthMode::Oauth,credential:"tskey-client-actualsecret".into(),tags:vec!["tag:worker".into()]};
        assert_eq!(validated_credential(&input).unwrap(),"tskey-client-actualsecret");
        for value in ["tskey-client-secret?baseURL=https://untrusted","tskey-auth-secret","file:/path","tskey-client-secret\ncommand"] {
            assert!(validated_credential(&TailscaleAuthInput{credential:value.into(),mode:TailscaleAuthMode::Oauth,tags:vec!["tag:worker".into()]}).is_err());
        }
        assert!(validated_credential(&TailscaleAuthInput{credential:"tskey-client-secret".into(),mode:TailscaleAuthMode::Oauth,tags:vec![]}).is_err());
    }
}
