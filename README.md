# RiderX

Core pieces built so far (all tested):

- `src/engine/payout.ts` – payout engine, integer paise, versioned rate card shape
- `src/engine/calendar.ts` – Monday–Sunday cycles, Friday-of-following-week pay date
- `src/import/zomatoParser.ts` – reads Zomato per-trip payout sheets, reports problems per row
- `supabase/migrations/0001_core.sql` – database schema with row-level security
- `tests/` – run `npm test`. For the real-file tests: `ZOMATO_SAMPLE=/path/to/file.xlsx npm test`

Rules implemented (confirmed by the owner, 12 Oct 2026):
- Extra km = (pickup + drop) − 6, ₹5/km. Batched trip counts as 2 orders, +₹30 once per batched trip.
- Operational day changes at IST midnight (delivered_at). Weekly cycle Mon–Sun, paid Friday of following week.
- Tips are excluded from payroll. Zomato's pay to RiderX is revenue, never rider pay.
