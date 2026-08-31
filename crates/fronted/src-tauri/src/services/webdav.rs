
//




use std::time::Duration;

use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use reqwest::{Client, Method, Response, StatusCode};

use crate::services::system_proxy;

const WEBDAV_META_TIMEOUT: Duration = Duration::from_secs(30);
const WEBDAV_TRANSFER_TIMEOUT: Duration = Duration::from_secs(300);


const PATH_SEGMENT_ESCAPE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'/')
    .add(b'\\');

#[derive(Debug, Clone)]
pub struct WebdavCredentials {
    pub base_url: String,
    pub username: String,
    pub password: String,
}

fn method_propfind() -> Method {
    Method::from_bytes(b"PROPFIND").expect("PROPFIND is a valid HTTP method token")
}

fn method_mkcol() -> Method {
    Method::from_bytes(b"MKCOL").expect("MKCOL is a valid HTTP method token")
}


fn build_client(timeout: Duration) -> Result<Client, String> {
    system_proxy::async_client_builder()?
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| "创建 WebDAV HTTP 客户端失败".to_string())
}


pub fn join_url(base: &str, segments: &[&str]) -> String {
    let mut url = base.trim_end_matches('/').to_string();
    for segment in segments {
        for part in segment.split('/') {
            if part.is_empty() {
                continue;
            }
            url.push('/');
            url.push_str(&utf8_percent_encode(part, PATH_SEGMENT_ESCAPE).to_string());
        }
    }
    url
}

pub fn dir_url(base: &str, segments: &[&str]) -> String {
    format!("{}/", join_url(base, segments))
}


pub fn redact_url_for_log(url: &str) -> String {
    let (scheme, rest) = match url.split_once("://") {
        Some((scheme, rest)) => (Some(scheme), rest),
        None => (None, url),
    };
    
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let (authority, path) = rest.split_at(authority_end);
    let host = match authority.rsplit_once('@') {
        Some((_userinfo, host)) => host,
        None => authority,
    };
    let path = path.split('?').next().unwrap_or("");
    match scheme {
        Some(scheme) => format!("{scheme}://{host}{path}"),
        None => format!("{host}{path}"),
    }
}


fn is_jianguoyun(url: &str) -> bool {
    let host = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    
    ["jianguoyun.com", "nutstore.net", "nutstore.com"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn describe_status_error(url: &str, status: StatusCode, action: &str) -> String {
    let jianguoyun = is_jianguoyun(url);
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            if jianguoyun {
                "认证失败：坚果云要求使用「第三方应用管理」中生成的应用密码，而不是账号登录密码；同时确认服务器地址为 https://dav.jianguoyun.com/dav/".to_string()
            } else {
                format!("认证失败（{status}）：请检查用户名与密码")
            }
        }
        StatusCode::NOT_FOUND => {
            if jianguoyun {
                "路径不存在：坚果云的 WebDAV 可写目录必须位于 /dav/ 之下，请确认服务器地址与远端目录".to_string()
            } else {
                format!("路径不存在（{status}）：请检查服务器地址与远端目录")
            }
        }
        StatusCode::CONFLICT => {
            if jianguoyun {
                "创建目录失败：坚果云不允许通过 WebDAV 自动创建顶层文件夹，请先在网页端手动创建该目录".to_string()
            } else {
                format!("创建目录失败（{status}）：上级目录可能不存在")
            }
        }
        StatusCode::INSUFFICIENT_STORAGE => "远端存储空间不足".to_string(),
        status if status.is_redirection() => {
            if jianguoyun {
                format!("服务器返回重定向（{status}）：坚果云的 WebDAV 地址应为 https://dav.jianguoyun.com/dav/，请勿使用网页版地址")
            } else {
                format!("服务器返回重定向（{status}）：地址可能不是 WebDAV 入口")
            }
        }
        status => format!("{action}失败：服务器返回 {status}"),
    }
}

fn map_request_error(url: &str, action: &str, error: &reqwest::Error) -> String {
    let redacted = redact_url_for_log(url);
    if error.is_timeout() {
        return format!("{action}超时：{redacted}");
    }
    if error.is_connect() {
        return format!("{action}失败：无法连接到 {redacted}");
    }
    format!("{action}失败：{redacted}")
}


async fn propfind_ok(creds: &WebdavCredentials, url: &str) -> Result<bool, String> {
    let client = build_client(WEBDAV_META_TIMEOUT)?;
    let response = client
        .request(method_propfind(), url)
        .basic_auth(&creds.username, Some(&creds.password))
        .header("Depth", "0")
        .send()
        .await
        .map_err(|e| map_request_error(url, "连接 WebDAV 服务器", &e))?;

    let status = response.status();
    if status.is_success() || status == StatusCode::MULTI_STATUS {
        return Ok(true);
    }
    if status == StatusCode::NOT_FOUND {
        return Ok(false);
    }
    Err(describe_status_error(url, status, "连接 WebDAV 服务器"))
}

pub async fn test_connection(creds: &WebdavCredentials) -> Result<(), String> {
    let url = dir_url(&creds.base_url, &[]);
    if propfind_ok(creds, &url).await? {
        Ok(())
    } else {
        Err(describe_status_error(
            &url,
            StatusCode::NOT_FOUND,
            "连接 WebDAV 服务器",
        ))
    }
}


fn dir_ladder<'a>(segments: &[&'a str]) -> Vec<&'a str> {
    segments
        .iter()
        .flat_map(|segment| segment.split('/'))
        .filter(|part| !part.is_empty())
        .collect()
}


pub async fn ensure_remote_dirs(
    creds: &WebdavCredentials,
    segments: &[&str],
) -> Result<(), String> {
    let client = build_client(WEBDAV_META_TIMEOUT)?;
    let ladder = dir_ladder(segments);
    let mut accumulated: Vec<&str> = Vec::with_capacity(ladder.len());

    for part in ladder {
        accumulated.push(part);
        let url = dir_url(&creds.base_url, &accumulated);
        let response = client
            .request(method_mkcol(), &url)
            .basic_auth(&creds.username, Some(&creds.password))
            .send()
            .await
            .map_err(|e| map_request_error(&url, "创建远端目录", &e))?;

        let status = response.status();
        if status.is_success() {
            continue;
        }
        let may_already_exist = status == StatusCode::METHOD_NOT_ALLOWED
            || status == StatusCode::CONFLICT
            || status.is_redirection();
        if may_already_exist && propfind_ok(creds, &url).await? {
            continue;
        }
        return Err(describe_status_error(&url, status, "创建远端目录"));
    }
    Ok(())
}


async fn read_body_capped(
    mut response: Response,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| format!("读取{label}失败：连接中断"))?
    {
        if buffer.len() + chunk.len() > max_bytes {
            return Err(format!("{label}超过大小上限（{max_bytes} 字节）"));
        }
        buffer.extend_from_slice(&chunk);
    }
    Ok(buffer)
}

pub async fn put_bytes(
    creds: &WebdavCredentials,
    segments: &[&str],
    body: Vec<u8>,
    content_type: &str,
) -> Result<(), String> {
    let url = join_url(&creds.base_url, segments);
    let client = build_client(WEBDAV_TRANSFER_TIMEOUT)?;
    let response = client
        .put(&url)
        .basic_auth(&creds.username, Some(&creds.password))
        .header("Content-Type", content_type)
        .body(body)
        .send()
        .await
        .map_err(|e| map_request_error(&url, "上传", &e))?;

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(describe_status_error(&url, status, "上传"))
    }
}

pub async fn get_bytes(
    creds: &WebdavCredentials,
    segments: &[&str],
    max_bytes: usize,
    label: &str,
) -> Result<Option<Vec<u8>>, String> {
    let url = join_url(&creds.base_url, segments);
    let client = build_client(WEBDAV_TRANSFER_TIMEOUT)?;
    let response = client
        .get(&url)
        .basic_auth(&creds.username, Some(&creds.password))
        .send()
        .await
        .map_err(|e| map_request_error(&url, "下载", &e))?;

    let status = response.status();
    if status == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(describe_status_error(&url, status, "下载"));
    }
    Ok(Some(read_body_capped(response, max_bytes, label).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_url_trims_and_skips_empty_segments() {
        assert_eq!(
            join_url("https://example.com/dav/", &["xgent", "v1"]),
            "https://example.com/dav/xgent/v1"
        );
        
        assert_eq!(
            join_url("https://example.com/dav", &["//xgent//", "/v1/"]),
            "https://example.com/dav/xgent/v1"
        );
        assert_eq!(
            join_url("https://example.com/dav/", &[]),
            "https://example.com/dav"
        );
    }

    #[test]
    fn dir_ladder_flattens_multi_level_segments() {
        
        
        assert_eq!(
            dir_ladder(&["a/b", "v1", "default"]),
            ["a", "b", "v1", "default"]
        );
        
        assert_eq!(dir_ladder(&["//a//", "/b/"]), ["a", "b"]);
    }

    #[test]
    fn join_url_percent_encodes_spaces_and_non_ascii() {
        assert_eq!(
            join_url("https://example.com/dav", &["my backup"]),
            "https://example.com/dav/my%20backup"
        );
        assert_eq!(
            join_url("https://example.com/dav", &["配置"]),
            "https://example.com/dav/%E9%85%8D%E7%BD%AE"
        );
        
        assert_eq!(
            join_url("https://example.com/dav", &["config-v1.2_final~x.json"]),
            "https://example.com/dav/config-v1.2_final~x.json"
        );
        
        assert_eq!(
            join_url("https://example.com/dav", &["a?b"]),
            "https://example.com/dav/a%3Fb"
        );
    }

    #[test]
    fn dir_url_keeps_trailing_slash() {
        assert_eq!(
            dir_url("https://example.com/dav/", &["v1"]),
            "https://example.com/dav/v1/"
        );
        assert_eq!(
            dir_url("https://example.com/dav/", &[]),
            "https://example.com/dav/"
        );
    }

    #[test]
    fn redact_url_strips_userinfo_and_query() {
        assert_eq!(
            redact_url_for_log("https://alice:s3cret@example.com/dav/x?token=abc"),
            "https://example.com/dav/x"
        );
        assert_eq!(
            redact_url_for_log("https://example.com/dav/x"),
            "https://example.com/dav/x"
        );
        
        assert_eq!(
            redact_url_for_log("https://example.com/dav/a@b"),
            "https://example.com/dav/a@b"
        );
        assert_eq!(redact_url_for_log("example.com/dav?x=1"), "example.com/dav");
    }

    #[test]
    fn detects_jianguoyun_hosts() {
        assert!(is_jianguoyun("https://dav.jianguoyun.com/dav/"));
        assert!(is_jianguoyun("https://DAV.JianGuoYun.com/dav/"));
        
        assert!(is_jianguoyun(
            "https://dav.jianguoyun.com.nutstore.net/dav/"
        ));
        assert!(is_jianguoyun("https://app.nutstore.net/dav/"));
        assert!(!is_jianguoyun("https://example.com/dav/"));
        
        assert!(!is_jianguoyun("https://jianguoyun.com.evil.test/dav/"));
        assert!(!is_jianguoyun("https://nutstore.net.evil.test/dav/"));
        
        assert!(!is_jianguoyun("https://mynutstore.example/dav/"));
    }

    #[test]
    fn jianguoyun_errors_mention_app_password_and_manual_folder() {
        let url = "https://dav.jianguoyun.com/dav/xgent/";
        let unauthorized = describe_status_error(url, StatusCode::UNAUTHORIZED, "连接");
        assert!(unauthorized.contains("应用密码"), "{unauthorized}");

        let conflict = describe_status_error(url, StatusCode::CONFLICT, "创建远端目录");
        assert!(conflict.contains("网页端手动创建"), "{conflict}");

        let not_found = describe_status_error(url, StatusCode::NOT_FOUND, "下载");
        assert!(not_found.contains("/dav/"), "{not_found}");

        let redirect = describe_status_error(url, StatusCode::FOUND, "连接");
        assert!(redirect.contains("dav.jianguoyun.com"), "{redirect}");
    }

    #[test]
    fn generic_errors_stay_generic() {
        let url = "https://example.com/dav/";
        let unauthorized = describe_status_error(url, StatusCode::UNAUTHORIZED, "连接");
        assert!(!unauthorized.contains("坚果云"), "{unauthorized}");
        assert!(unauthorized.contains("用户名与密码"), "{unauthorized}");

        let storage = describe_status_error(url, StatusCode::INSUFFICIENT_STORAGE, "上传");
        assert!(storage.contains("空间不足"), "{storage}");

        
        let teapot = describe_status_error(url, StatusCode::IM_A_TEAPOT, "上传");
        assert!(teapot.contains("上传失败"), "{teapot}");
    }

    #[test]
    fn error_text_never_leaks_credentials() {
        let url = "https://alice:s3cret@dav.jianguoyun.com/dav/x?token=abc";
        for status in [
            StatusCode::UNAUTHORIZED,
            StatusCode::NOT_FOUND,
            StatusCode::CONFLICT,
            StatusCode::IM_A_TEAPOT,
        ] {
            let message = describe_status_error(url, status, "上传");
            assert!(!message.contains("s3cret"), "{message}");
            assert!(!message.contains("token=abc"), "{message}");
        }
    }

        ///
        /// ```text
    /// XGENT_WEBDAV_URL=https://dav.jianguoyun.com/dav/ \
    /// XGENT_WEBDAV_USER=... \
    /// XGENT_WEBDAV_PASS=... \
    /// cargo test --lib services::webdav::tests::live -- --ignored --nocapture
    /// ```
        ///
            #[tokio::test]
    #[ignore = "需要真实 WebDAV 账号，通过 XGENT_WEBDAV_* 环境变量提供"]
    async fn live_webdav_end_to_end() {
        let (Ok(base_url), Ok(username), Ok(password)) = (
            std::env::var("XGENT_WEBDAV_URL"),
            std::env::var("XGENT_WEBDAV_USER"),
            std::env::var("XGENT_WEBDAV_PASS"),
        ) else {
            eprintln!("跳过：未设置 XGENT_WEBDAV_URL / _USER / _PASS");
            return;
        };

        let creds = WebdavCredentials {
            base_url,
            username,
            password,
        };

        
        test_connection(&creds)
            .await
            .expect("test_connection 应成功");
        eprintln!("① test_connection: ok");

        
        let bad = WebdavCredentials {
            password: "definitely-not-the-password".to_string(),
            ..creds.clone()
        };
        let err = test_connection(&bad).await.expect_err("错误密码应认证失败");
        assert!(err.contains("认证失败"), "{err}");
        assert!(
            !err.contains("definitely-not-the-password"),
            "错误文案不得回显凭据：{err}"
        );
        eprintln!("② 错误密码: {err}");

        
        let dir = format!("xgent-livetest-{}", std::process::id());
        ensure_remote_dirs(&creds, &[&dir])
            .await
            .expect("ensure_remote_dirs 应成功");
        
        ensure_remote_dirs(&creds, &[&dir])
            .await
            .expect("ensure_remote_dirs 应幂等");
        eprintln!("③ ensure_remote_dirs（含幂等重试）: ok");

        
        let body = r#"{"hello":"webdav","zh":"中文"}"#.as_bytes().to_vec();
        put_bytes(
            &creds,
            &[&dir, "probe.json"],
            body.clone(),
            "application/json",
        )
        .await
        .expect("put_bytes 应成功");
        let fetched = get_bytes(&creds, &[&dir, "probe.json"], 1024 * 1024, "探针")
            .await
            .expect("get_bytes 应成功")
            .expect("刚上传的文件必须存在");
        assert_eq!(fetched, body, "下行字节必须与上行完全一致");
        eprintln!("④ put/get 往返 {} 字节: 一致", body.len());

        
        let missing = get_bytes(&creds, &[&dir, "no-such-file.json"], 1024, "探针")
            .await
            .expect("404 不应报错");
        assert!(missing.is_none(), "缺失文件应返回 Ok(None)");
        eprintln!("⑤ 缺失文件: Ok(None)");
    }
}
