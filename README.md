# Common Room — Campus Canteen

A static campus canteen dashboard with menu filters, a daily special, crowd
feedback, and browser-local admin editing.

## Run locally

Serve this folder with any static web server and open its URL in a browser. The
app starts in offline demo mode and saves menu edits, votes, and admin settings
in that browser's local storage. No Supabase credentials are required.

The Supabase schema used by the optional hosted backend is in
[`supabase/schema.sql`](./supabase/schema.sql). Never put a Supabase secret or
service-role key in this static frontend.
