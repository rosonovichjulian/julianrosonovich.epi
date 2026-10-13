// Configuración de la plataforma.
// Ya completado con el proyecto de Supabase del Observatorio.
// Supabase → Project Settings → API (o "Data API")
window.OBS_CONFIG = {
  SUPABASE_URL: 'https://guyritmavxzotecfkaim.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1eXJpdG1hdnh6b3RlY2ZrYWltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDM2NTAsImV4cCI6MjEwNzQxOTY1MH0.hZ06k9_iq6S8ywLVR2w0kZhqvWI3VAmC3JS4S8e45m4',

  // Los usuarios se escriben como "malvinas-argentinas"; internamente se guardan con este dominio.
  // No hace falta que reciba mails. No lo cambies después de crear usuarios.
  DOMINIO_USUARIOS: 'usuarios.julianrosonovich-epi.vercel.app'
};
