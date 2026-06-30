-- Support the remove-employee (anonymize) flow: marks when an employee was
-- permanently removed. NULL = active/never removed. The row itself is kept for
-- payroll/compliance history; only the name/pin/active fields are anonymized.
alter table employees add column if not exists removed_at timestamptz;

-- Anonymizing a removed employee clears their PIN (so the 4-digit PIN is freed
-- for reuse by a future hire). That requires pin to be nullable; the original
-- schema declared it NOT NULL. Postgres treats NULLs as distinct in unique
-- indexes, so multiple removed employees with pin = NULL is fine.
alter table employees alter column pin drop not null;
