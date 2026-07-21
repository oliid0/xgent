package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xagent/agent-gateway/internal/auth"
	"github.com/xagent/agent-gateway/internal/config"
	"github.com/xagent/agent-gateway/internal/handler"
	gatewayv1 "github.com/xagent/agent-gateway/internal/proto/v1"
	"github.com/xagent/agent-gateway/internal/protocol/pbws"
	"github.com/xagent/agent-gateway/internal/session"
)

func NewHTTPServer(cfg *config.Config, sm *session.Manager) http.Handler {
	rootMux := http.NewServeMux()
	rootMux.HandleFunc("GET /healthz", handler.Health())

	// v2 统一协议（WebSocket+Protobuf）三链路。
	v2 := pbws.NewServer(cfg, sm)
	rootMux.Handle("/ws/v2", v2.BrowserHandler())
	rootMux.Handle("/ws/v2/agent", v2.AgentHandler())
	rootMux.Handle("/ws/v2/terminal", v2.TerminalHandler())

	// v1 路由（JSON 信封 /ws、二进制终端流 /ws/terminal）已移除：显式回 410，
	// 让未刷新的旧客户端得到可诊断的拒绝，而不是落进 SPA fallback 拿到 index.html。
	goneV1 := func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "v1 websocket protocol removed; upgrade to /ws/v2", http.StatusGone)
	}
	rootMux.HandleFunc("/ws", goneV1)
	rootMux.HandleFunc("/ws/terminal", goneV1)

	rootMux.HandleFunc("/t/", publicTunnelProxy(sm))
	rootMux.HandleFunc("GET /image-proxy", handler.ImageProxy(cfg.RequestTimeout))
	rootMux.HandleFunc("GET /api/public/history-shares/{token}", publicHistoryShare(cfg, sm))

	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/status", handler.Status(sm))
	apiMux.HandleFunc("POST /api/files/import", handler.ImportReadableFiles(sm, cfg.RequestTimeout))
	rootMux.Handle("/api/", auth.HTTPMiddleware(cfg.Token, apiMux))

	return rootMux
}

func publicHistoryShare(cfg *config.Config, sm *session.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.PathValue("token"))
		if token == "" {
			writePublicHistoryShareError(w, http.StatusNotFound, "share not found")
			return
		}

		timeout := cfg.RequestTimeout
		if timeout <= 0 {
			timeout = 2 * time.Minute
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		requestID := "public-history-share-" + uuid.NewString()
		response, err := sm.AwaitUnaryResponse(ctx, requestID, &gatewayv1.GatewayEnvelope{
			RequestId: requestID,
			Timestamp: time.Now().Unix(),
			Payload: &gatewayv1.GatewayEnvelope_HistoryShareResolve{
				HistoryShareResolve: &gatewayv1.HistoryShareResolveRequest{
					Token: token,
				},
			},
		})
		if err != nil {
			switch {
			case errors.Is(err, session.ErrAgentOffline):
				writePublicHistoryShareError(w, http.StatusServiceUnavailable, "agent offline")
			case errors.Is(err, context.DeadlineExceeded):
				writePublicHistoryShareError(w, http.StatusGatewayTimeout, "request timed out")
			default:
				writePublicHistoryShareError(w, http.StatusInternalServerError, "share request failed")
			}
			return
		}
		if errResp := response.GetError(); errResp != nil {
			writePublicHistoryShareError(w, handler.GatewayErrorStatus(errResp), errResp.GetMessage())
			return
		}

		share := response.GetHistoryShareResolveResp()
		if share == nil {
			writePublicHistoryShareError(w, http.StatusBadGateway, "unexpected agent response")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"conversation_id":     share.GetConversationId(),
			"messages_json":       share.GetMessagesJson(),
			"total_message_count": share.GetTotalMessageCount(),
			"conversation":        conversationSummaryPayload(share.GetConversation()),
			"redact_tool_content": share.GetRedactToolContent(),
		})
	}
}

func writePublicHistoryShareError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"error": strings.TrimSpace(message),
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
