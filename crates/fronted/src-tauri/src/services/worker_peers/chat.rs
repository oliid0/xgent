//! Interactive RPC and events use the same protected endpoint selection as
//! durable work, without exposing the durable task command allowlist.
use super::*;
use crate::services::lan_pc_client::LanPcSubscription;

impl WorkerPeerRegistry {
    async fn chat_client(&self, peer_id: &str) -> Result<(StoredEndpoint, Arc<LanPcClient>), String> {
        let (stored, clients) = self.entry(peer_id).await?;
        let (selection, _) = Self::probe_entry(&stored, &clients).await;
        let (endpoint, client, _) = selection?;
        let (current, _) = self.entry(peer_id).await?;
        if !current.endpoints().iter().any(|known|
            known.base_url == endpoint.base_url && known.session_id == endpoint.session_id) {
            return Err("Original computer pairing changed during connection; reconnect and retry".into());
        }
        Ok((endpoint, client))
    }

    pub async fn invoke_chat(&self, base_url: &str, peer_id: Option<&str>, command: &str, args: Value) -> Result<Value, String> {
        let peer_id = match peer_id {
            Some(id) => id.to_string(),
            None => self.resolve_endpoint(base_url).await?,
        };
        let (endpoint, client) = self.chat_client(&peer_id).await?;
        // The server still enforces the current command permissions. Choose
        // before sending; a lost response must never replay an unknown write.
        client.invoke(Some(&endpoint.base_url), command, args).await
    }

    pub async fn subscribe_chat(&self, base_url: &str, peer_id: Option<&str>, event: &str, relay_id: &str,
        app: tauri::AppHandle) -> Result<(LanPcSubscription, String), String> {
        let peer_id = match peer_id {
            Some(id) => id.to_string(),
            None => self.resolve_endpoint(base_url).await?,
        };
        let (endpoint, client) = self.chat_client(&peer_id).await?;
        let subscription = client.subscribe(Some(&endpoint.base_url), event, relay_id, app).await?;
        let peers = self.peers.lock().await;
        if !peers.get(&peer_id).is_some_and(|entry| entry.clients.iter().any(|(known, owner)|
            known.session_id == endpoint.session_id && Arc::ptr_eq(owner, &client))) {
            drop(peers);
            let _ = client.unsubscribe(&subscription.subscription_id).await;
            return Err("Original computer pairing was removed during event subscription".into());
        }
        self.chat_subscriptions.lock().await.insert(subscription.subscription_id.clone(),
            (peer_id.clone(), client));
        Ok((subscription, peer_id))
    }

    pub async fn unsubscribe_chat(&self, subscription_id: &str) -> Result<(), String> {
        let owner = self.chat_subscriptions.lock().await.remove(subscription_id);
        if let Some((_, client)) = owner { client.unsubscribe(subscription_id).await?; }
        Ok(())
    }

    pub(super) async fn retire_chat_client(&self, client: &Arc<LanPcClient>) {
        self.chat_subscriptions.lock().await.retain(|_, (_, owner)| !Arc::ptr_eq(owner, client));
        client.retire().await;
    }
}
