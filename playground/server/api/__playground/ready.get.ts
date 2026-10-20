import { defineEventHandler } from 'h3'

/** Readiness for the browser tests' web server. */
export default defineEventHandler(() => ({ ready: true }))
