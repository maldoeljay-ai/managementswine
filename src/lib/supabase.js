import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://oinkscyfesawucfakzxk.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pbmtzY3lmZXNhd3VjZmFrenhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NTAzNTQsImV4cCI6MjEwMTQyNjM1NH0.nvqGE-5jupv7w1RRq6x-F22n5WwOlKvp9PdmMRG9W7I'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)