const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key']
}));
app.use(express.json());

app.get('/buscar', async (req, res) => {
  try {
    const { consulta } = req.query;
    if (!consulta) return res.status(400).json({ error: 'Falta el parámetro consulta' });

    const response = await axios.get('https://boe.es/buscar/act.php', {
      params: { 
        lang: 'es',
        q: consulta,
        b: 'A'
      },
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    res.json({ ok: true, data: response.data.substring(0, 3000) });
  } catch (error) {
    res.status(500).json({ error: error.message, status: error.response?.status });
  }
});

app.get('/norma/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(`https://www.boe.es/diario/boe/xml.php?id=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    res.json({ ok: true, data: response.data.substring(0, 8000) });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
