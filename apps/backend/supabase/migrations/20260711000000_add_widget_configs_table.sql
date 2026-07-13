-- Widget Configs
--
-- Persisted per-company widget appearance/UX config, so new customers can embed
-- a single script tag (src + companyId) instead of also pasting a JSON config
-- blob. Existing customers' embedded JSON continues to override any field this
-- table supplies -- this table only fills gaps, it never removes the ability
-- to explicitly override.
--
-- Deliberately additive only: does not touch companies, chat_configs, chats,
-- messages, analytics_events, or dashboard_users. chat_configs keeps owning
-- system_prompt/vector-namespace/support-email/active-hours; this table only
-- covers the appearance/UX fields the frontend embed config used to be the
-- sole owner of.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'update_updated_at_column'
          AND pronamespace = 'public'::regnamespace
    ) THEN
        RAISE EXCEPTION 'public.update_updated_at_column() is missing; apply 20240601000000_chat_configs_table.sql first';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS widget_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,

    title TEXT CHECK (char_length(title) <= 200),
    logo_url TEXT CHECK (char_length(logo_url) <= 2000),
    popup_message TEXT CHECK (char_length(popup_message) <= 1000),
    welcome_message TEXT CHECK (char_length(welcome_message) <= 5000),

    open_on_load TEXT CHECK (open_on_load IN ('all', 'mobile-only', 'desktop-only', 'none')),
    theme TEXT CHECK (theme IN ('primary', 'secondary')),

    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggestions) = 'array'),
    powered_by  JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(powered_by) = 'object'),
    styles      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(styles) = 'object'),
    locales     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(locales) = 'object'),

    CONSTRAINT widget_configs_company_id_unique UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_widget_configs_company_id ON widget_configs (company_id);

-- CREATE TRIGGER has no IF NOT EXISTS in PG15, so guard it to stay re-runnable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_widget_configs_updated_at'
          AND tgrelid = 'public.widget_configs'::regclass
    ) THEN
        CREATE TRIGGER update_widget_configs_updated_at
        BEFORE UPDATE ON widget_configs
        FOR EACH ROW
        EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;

-- Service-role access only, same as chat_configs/demo_requests. All access goes
-- through the service-role key server-side; deliberately zero policies.
ALTER TABLE widget_configs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE widget_configs FROM anon;
REVOKE ALL ON TABLE widget_configs FROM authenticated;
GRANT ALL ON TABLE widget_configs TO service_role;

COMMENT ON TABLE widget_configs IS 'Per-company widget appearance/UX config, served publicly via GET /api/widget-config/:companyId. Embed-config JSON (legacy) still overrides any field set here.';
COMMENT ON COLUMN widget_configs.open_on_load IS 'Mirrors DialogueFoundryConfig.openOnLoad in the frontend.';
COMMENT ON COLUMN widget_configs.suggestions IS 'Array of {label?, prompt} objects, mirrors DialogueFoundryConfig.suggestions.';
COMMENT ON COLUMN widget_configs.powered_by IS 'Object shape {text?, url?, show?}, mirrors DialogueFoundryConfig.poweredBy.';
COMMENT ON COLUMN widget_configs.styles IS 'Object shape {primaryColor?, secondaryColor?, mutedColor?, accentColor?, backgroundColor?, foregroundColor?, fontFamily?}, mirrors DialogueFoundryConfig.styles.';
COMMENT ON COLUMN widget_configs.locales IS 'Per-language overrides keyed by SupportedLanguage, mirrors DialogueFoundryConfig.locales.';
