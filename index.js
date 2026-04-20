const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const BOE_BASE = 'https://boe.es/datosabiertos/api/legislacion-consolidada';

app.get('/buscar', async (req, res) => {
  try {
    const { consulta } = req.query;
    if (!consulta) return res.status(400).json({ error: 'Falta el parámetro consulta' });

    const query = JSON.stringify({
      query: {
        query_string: { query: `titulo:${consulta}` }
      },
      sort: [{ fecha_publicacion: 'desc' }]
    });

    const response = await axios.get(BOE_BASE, {
      params: { query, limit: 10 },
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const items = response.data?.data || [];
    const resultados = (Array.isArray(items) ? items : []).map(item => ({
      identificador: item.identificador,
      titulo: item.titulo,
      fecha_publicacion: item.fecha_publicacion,
      rango: item.rango?.texto || item.rango,
      departamento: item.departamento?.texto || item.departamento,
      vigencia_agotada: item.vigencia_agotada,
      url: item.url_html_consolidada
    }));

    res.json({ ok: true, resultados });

  } catch (error) {
    res.status(500).json({ error: error.message, status: error.response?.status });
  }
});

app.get('/norma/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const metaResponse = await axios.get(`${BOE_BASE}/id/${id}/metadatos`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });

    const textoResponse = await axios.get(`${BOE_BASE}/id/${id}/texto`, {
      headers: { 'Accept': 'application/xml', 'User-Agent': 'Mozilla/5.0' },
      responseType: 'text'
    });

    const parser = new xml2js.Parser({ explicitArray: false });
    const textoXml = await parser.parseStringPromise(textoResponse.data);

    const bloques = textoXml?.response?.data?.texto?.bloque;
    const bloquesArray = Array.isArray(bloques) ? bloques : (bloques ? [bloques] : []);

    let textoPlano = '';
    for (const bloque of bloquesArray.slice(0, 30)) {
      const titulo = bloque?.$?.titulo || '';
      const versiones = bloque?.version;
      const versionArray = Array.isArray(versiones) ? versiones : (versiones ? [versiones] : []);
      const ultimaVersion = versionArray[versionArray.length - 1];
      const parrafos = ultimaVersion?.p;
      const parrafoArray = Array.isArray(parrafos) ? parrafos : (parrafos ? [parrafos] : []);
      const textoBloque = parrafoArray.map(p => (typeof p === 'string' ? p : p?._ || '')).join(' ');
      if (titulo || textoBloque) {
        textoPlano += `\n${titulo}\n${textoBloque}\n`;
      }
    }

    res.json({
      ok: true,
      metadatos: metaResponse.data?.data || metaResponse.data,
      texto: textoPlano.substring(0, 12000)
    });

  } catch (error) {
    res.status(500).json({ error: error.message, status: error.response?.status });
  }
});

app.post('/analizar', async (req, res) => {
  try {
    const { textoLey, pregunta } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) return res.status(401).json({ error: 'Falta API key' });
    if (!textoLey || !pregunta) return res.status(400).json({ error: 'Faltan parámetros' });

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `Eres un analista legislativo especializado que trabaja para VOX.
Tu función es analizar textos legales desde la perspectiva programática de VOX,
identificando obstáculos regulatorios, interferencias en la libertad económica,
exceso de intervención estatal, incompatibilidades con la unidad nacional,
y oportunidades para proponer iniciativas legislativas alternativas.

Los principios que guían tu análisis son:
- Liberalización económica y reducción de la carga regulatoria
- Propiedad privada y seguridad jurídica para propietarios
- Reducción del gasto público y la burocracia
- Unidad nacional y rechazo al trato diferenciado por territorios
- Familia como institución central y apoyo a la natalidad
- Subsidiariedad: el Estado no debe hacer lo que puede hacer el individuo o la familia
- Simplificación normativa: derogar más de lo que se legisla

Cuando identifiques un problema en una ley, propón siempre una alternativa
legislativa concreta: qué artículo modificar, cómo redactarlo y qué objetivo persigue.`,
        messages: [
          {
            role: 'user',
            content: `TEXTO DE LA LEY:\n${textoLey}\n\nPREGUNTA:\n${pregunta}`
          }
        ]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    res.json({ analisis: response.data.content[0].text });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy VOX-Legislativo corriendo en puerto ${PORT}`);
});
