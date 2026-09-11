# Offline reports

Standalone research exports. **Nothing in this directory is read by the
application or the ingestion pipeline** — verified with:

```
grep -rln "\.xlsx" app lib components scripts    # no matches
```

They live here rather than in the repository root so the root contains only
production assets. Keeping them at the root invited the reasonable inference
that the "enterprise sources" were manually curated spreadsheets rather than
crawled from ATS APIs. They are not; the pipeline reads JSON from employers'
own endpoints and writes `public/data/jobs-v2.json`.
