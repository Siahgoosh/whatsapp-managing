#!/usr/bin/env node
const port = process.env.PORT || 9454;
const url = `http://127.0.0.1:${port}/health`;
try {
  const res = await fetch(url);
  if (!res.ok) process.exit(1);
  const data = await res.json();
  if (!data.ok) process.exit(1);
  process.exit(0);
} catch {
  process.exit(1);
}
