//! Settlement shares the authenticated original child-observation transaction.
use super::*;

impl AutomationStore {
    pub(super) fn settle_background_child_budget(conn:&Connection,id:&str,call:&str,child_execution:&str,value:&Value)->Result<(),String>{
        let grant:Option<(u64,u64)>=conn.query_row("SELECT max_model_requests,max_tool_calls FROM automation_background_budget_grants WHERE execution_id=?1 AND call_id=?2",
            params![id,call],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
        let Some((model_limit,tool_limit))=grant else{return Ok(());};
        let Some(budget)=value.get("executionBudget") else{return Ok(());};
        if budget["version"]!=1 || budget["executionId"]!=child_execution || budget["scope"]!="current_host_execution"
            || budget["durable"]!=true || budget["includesCompaction"]!=true || !budget["exhausted"].is_boolean()
            || !budget["includesDeviceDelegates"].is_boolean() {
            return Ok(()); // Unknown report retains the original full allocation.
        }
        let deadline=Self::background_budget_deadline(conn,id)?;
        let observed_deadline=match budget.get("deadlineAt") {
            None=>None,
            Some(value)=>match value.as_i64().filter(|time|*time>0 && *time<=8_640_000_000_000_000){Some(time)=>Some(time),None=>return Ok(())},
        };
        if observed_deadline!=deadline {return Ok(());}
        let total=|counter:&Value,limit:u64|->Option<u64>{
            if counter["limit"].as_u64()!=Some(limit){return None;}
            let used=counter["used"].as_u64()?;
            let reserved=match counter.get("reserved"){None=>0,Some(value)=>value.as_u64()?};
            used.checked_add(reserved).filter(|total|*total<=limit)
        };
        let Some(model)=total(&budget["modelRequests"],model_limit) else{return Ok(());};
        let Some(tools)=total(&budget["toolCalls"],tool_limit) else{return Ok(());};
        // Descendant committed slots stay charged; no inferred token/cost refund.
        conn.execute("INSERT INTO automation_background_budget_settlements(execution_id,call_id,child_request_id,peer_id,child_execution_id,model_requests,tool_calls,settled_at)
            SELECT g.execution_id,g.call_id,g.child_request_id,g.peer_id,?3,?4,?5,?6 FROM automation_background_budget_grants g
            JOIN automation_background_children c ON c.execution_id=g.execution_id AND c.call_id=g.call_id AND c.child_request_id=g.child_request_id AND c.peer_id=g.peer_id
            WHERE g.execution_id=?1 AND g.call_id=?2 AND c.observed_execution_id=?3 AND c.terminal_confirmed=1
            AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
            AND ?4 BETWEEN 0 AND g.max_model_requests AND ?5 BETWEEN 0 AND g.max_tool_calls
            ON CONFLICT(execution_id,call_id) DO NOTHING",params![id,call,child_execution,model,tools,db::now_ms()]).map_err(|e|e.to_string())?;
        Ok(())
    }
}
