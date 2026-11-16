/**
 * Public web UI of the DKE daemon. ponytail: hard-coded because this plugin is DKE-private;
 * change it here if the hostname moves.
 */
export const PASEO_WEB_URL = "https://paseo.dke.dev";

/** The conversation's page in the web UI (route `app/h/[serverId]/agent/[agentId]`). */
export function agentWebUrl(serverId: string, agentId: string): string {
  return `${PASEO_WEB_URL}/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}
