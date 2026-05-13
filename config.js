console.log(SUPABASE_URL);
const SUPABASE_URL = "https://ucbkhvjryunzvvmcvfma.supabase.co/rest/v1/";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjYmtodmpyeXVuenZ2bWN2Zm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTIyODEsImV4cCI6MjA5NDI2ODI4MX0.tq_Ers5cY_ph0qwXrZVse0gkZJi3o64cARE60Gio1Kc";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);
