use chrono::{Local, LocalResult, NaiveDate, TimeZone};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    commands::{history_db, subagent_store},
    services::memory::{MemoryHistorySearchMatch, MemorySearchArgs},
};
use uuid::Uuid;

const CHAT_HISTORY_FTS_REFRESH_BATCH_SIZE: usize = 8;
const DEFAULT_HISTORY_SEARCH_LIMIT: usize = 6;
const MAX_HISTORY_SEARCH_LIMIT: usize = 12;
const MAX_HISTORY_LIST_LIMIT: i64 = 200;

include!("types.rs");
include!("db.rs");
include!("repository.rs");
include!("message_ref.rs");
include!("fts.rs");
include!("segments.rs");
include!("search.rs");
include!("trajectory.rs");
include!("trajectory_lifecycle.rs");
include!("trajectory_window.rs");
include!("trajectory_subagents.rs");
include!("commands.rs");
include!("replace.rs");
include!("branch.rs");
include!("delete.rs");
include!("tests.rs");
