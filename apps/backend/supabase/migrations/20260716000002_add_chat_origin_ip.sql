-- Chat request origin + IP
--
-- Captured on chat creation so the funnel poller can tell a genuine prospect
-- chat on the demo page apart from the team's own testing. The poller excludes
-- chats whose ip_address is one of the known team IPs; origin_domain is stored
-- alongside as useful context (e.g. distinguishing a chat on the hosted demo
-- page from one on a customer's live site once the widget is installed).
--
-- Additive only: two nullable columns on chats. Both stay NULL for historical
-- rows and for any request where the value is unavailable.

ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS ip_address INET,
    ADD COLUMN IF NOT EXISTS origin_domain TEXT CHECK (char_length(origin_domain) <= 255);

COMMENT ON COLUMN chats.ip_address IS 'Requester IP at chat creation (Express req.ip, trust proxy is set). Used by the demo funnel to exclude team-testing chats.';
COMMENT ON COLUMN chats.origin_domain IS 'Normalized hostname from the chat-creation request Origin header, when present.';
