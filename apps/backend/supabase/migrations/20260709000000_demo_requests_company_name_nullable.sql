-- Demo Requests: company_name becomes optional
--
-- The marketing site's demo form no longer collects a company name -- only
-- a website URL. The demo-setup worker now derives the company name itself
-- (from the business-name extraction already run during the crawl, falling
-- back to the site's own branding/title, falling back to the domain), and
-- writes it back onto this row once known. Until that happens the column is
-- simply null.

ALTER TABLE demo_requests ALTER COLUMN company_name DROP NOT NULL;

COMMENT ON COLUMN demo_requests.company_name IS 'Optional going forward -- the marketing site no longer collects this. Null until the demo-setup worker derives it from the crawl and writes it back.';
