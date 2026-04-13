import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

// Cargar .env.local manualmente para asegurar precisión
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const [key, ...value] = line.split('=');
  if (key && value) env[key.trim()] = value.join('=').trim();
});

const apiKey = env['GEMINI_API_KEY'];

async function listModels() {
  if (!apiKey) {
    console.error('No se encontró GEMINI_API_KEY en .env.local');
    return;
  }
  
  console.log('Usando API Key:', apiKey.substring(0, 5) + '...');

  try {
    const responseBeta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const dataBeta = await responseBeta.json();
    
    if (dataBeta.error) {
      console.log('\n--- Error de la API ---');
      console.log(JSON.stringify(dataBeta.error, null, 2));
      return;
    }

    console.log('\n--- Modelos Disponibles (v1beta) ---');
    dataBeta.models.forEach((m: any) => {
      console.log(`- ${m.name} (${m.supportedGenerationMethods.join(', ')})`);
    });
  } catch (error) {
    console.error('Error al conectar con Gemini:', error);
  }
}

listModels();
