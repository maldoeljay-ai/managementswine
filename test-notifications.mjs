import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
let supabaseUrl, supabaseAnonKey;
for (const line of env.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) supabaseAnonKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { data, error } = await supabase.from('notifications').select('*').limit(1);
  if (error) {
    console.error('Error fetching notifications:', error.message, error.details, error.hint, error.code);
  } else {
    console.log('Notifications table exists. Data:', data);
  }
}
test();
