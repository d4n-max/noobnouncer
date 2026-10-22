import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyGuildState } from "./EmptyGuildState";
function render(isBotOwner: boolean, error = "") {
  return renderToStaticMarkup(<EmptyGuildState session={{ user: { id: "100000000000000001", username: "Example", avatar_url: null }, csrfToken: "fixture", isBotOwner }} error={error} refreshing={false} onRefresh={() => {}} onInvite={() => {}} onLogout={() => {}} />);
}
test("Empty owner onboarding offers bot invitation, refresh and logout", () => {
  const html = render(true);
  assert.match(html, /Invite bot/); assert.match(html, /refresh to start scheduling/);
  assert.match(html, /Refresh servers/); assert.match(html, /Logout/);
});
test("Unauthorized users keep the administrator guidance and no invite button", () => {
  const html = render(false);
  assert.match(html, /Ask a server administrator/); assert.doesNotMatch(html, /Invite bot/);
});
test("Discovery outages remain visible and escaped in the empty state", () => {
  const html = render(true, "Discord unavailable <retry>");
  assert.match(html, /role="alert"/); assert.match(html, /&lt;retry&gt;/);
});
