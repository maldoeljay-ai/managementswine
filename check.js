import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

let envStr = '';
try {
  envStr = fs.readFileSync('./.env.local', 'utf8');
} catch(e) {
  envStr = fs.readFileSync('./.env', 'utf8');
}

const env = {};
envStr.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) env[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.from('pigs').insert({ tag: 'TEST-CHECK', gender: 'male', reproductive_status: 'Fattener', status: 'active' });
  console.log("Insert Error:", error);
}
check();
