require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// HubSpot API configuration
const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Validate HubSpot token on startup
if (!HUBSPOT_TOKEN) {
  console.error('❌ ERROR: HUBSPOT_ACCESS_TOKEN not found in .env file');
  console.error('Please create a .env file and add your HubSpot Private App token');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY not set. /api/ai/overview will return a fallback summary.');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString()
  });
});


// ==============================
// CONTACTS
// ==============================

// GET - 50 most recent contacts, sorted by createdate DESC
app.get('/api/contacts', async (req, res) => {
  try {
    const searchBody = {
      sorts: [
        { propertyName: 'createdate', direction: 'DESCENDING' }
      ],
      limit: 50,
      properties: ['firstname', 'lastname', 'email', 'phone', 'address', 'city', 'state', 'country', 'createdate']
    };

    const response = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
      searchBody,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Return just the array of contacts for the frontend
    res.json(response.data.results || []);
  } catch (error) {
    console.error('Error fetching contacts:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch contacts',
      details: error.response?.data || error.message
    });
  }
});

// POST - Create new contact
app.post('/api/contacts', async (req, res) => {
  try {
    const response = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts`,
      {
        properties: req.body.properties
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error creating contact:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to create contact',
      details: error.response?.data || error.message
    });
  }
});


// ==============================
// DEALS
// ==============================

// GET - Fetch all deals (not used by UI, but kept for completeness)
app.get('/api/deals', async (req, res) => {
  try {
    const response = await axios.get(
      `${HUBSPOT_API_BASE}/crm/v3/objects/deals`,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 50,
          properties: 'dealname,amount,dealstage,closedate,pipeline'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching deals:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch deals',
      details: error.response?.data || error.message
    });
  }
});

// POST - Create new deal and associate to contact
app.post('/api/deals', async (req, res) => {
  try {
    const { dealProperties, contactId } = req.body;

    const dealResponse = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/deals`,
      {
        properties: dealProperties,
        associations: contactId
          ? [
              {
                to: { id: contactId },
                types: [
                  {
                    associationCategory: 'HUBSPOT_DEFINED',
                    associationTypeId: 3 // Deal to Contact
                  }
                ]
              }
            ]
          : []
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json(dealResponse.data);
  } catch (error) {
    console.error('Error creating deal:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to create deal',
      details: error.response?.data || error.message
    });
  }
});

// GET - Deals associated with a specific contact
app.get('/api/contacts/:contactId/deals', async (req, res) => {
  try {
    const { contactId } = req.params;

    // First, get associated deal IDs
    const associationsResponse = await axios.get(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/deals`,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const assocResults = associationsResponse.data.results || [];

    if (assocResults.length === 0) {
      return res.json({ results: [] });
    }

    const dealIds = assocResults.map(r => r.id);

    // Then batch-read deals
    const dealsResponse = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/deals/batch/read`,
      {
        inputs: dealIds.map(id => ({ id })),
        properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline']
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json(dealsResponse.data);
  } catch (error) {
    console.error('Error fetching deals for contact:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch deals for contact',
      details: error.response?.data || error.message
    });
  }
});


// ==============================
// AI OVERVIEW – Gemini
// ==============================

app.post('/api/ai/overview', async (req, res) => {
  try {
    const { limit = 5 } = req.body || {};
    const contactLimit = Number(limit) || 5;

    // 1) Fetch most recent contacts
    const contactsSearchBody = {
      sorts: [
        { propertyName: 'createdate', direction: 'DESCENDING' }
      ],
      limit: contactLimit,
      properties: ['firstname', 'lastname', 'email', 'phone', 'address', 'city', 'state', 'country', 'createdate']
    };

    const contactsResp = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
      contactsSearchBody,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const recentContacts = contactsResp.data.results || [];

    // 2) For each contact, fetch associated deals
    const contactSummaries = [];

    for (const contact of recentContacts) {
      const contactId = contact.id;
      const props = contact.properties || {};
      let deals = [];

      try {
        const assocResp = await axios.get(
          `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/deals`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const dealIds = (assocResp.data.results || []).map(r => r.id);

        if (dealIds.length > 0) {
          const dealsResp = await axios.post(
            `${HUBSPOT_API_BASE}/crm/v3/objects/deals/batch/read`,
            {
              inputs: dealIds.map(id => ({ id })),
              properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'dealtype']
            },
            {
              headers: {
                Authorization: `Bearer ${HUBSPOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );

          deals = (dealsResp.data.results || []).map(d => ({
            id: d.id,
            name: d.properties?.dealname,
            amount: d.properties?.amount,
            stage: d.properties?.dealstage,
            closedate: d.properties?.closedate,
            pipeline: d.properties?.pipeline,
            type: d.properties?.dealtype
          }));
        }
      } catch (assocErr) {
        console.warn(
          `⚠️ Failed to fetch deals for contact ${contactId}:`,
          assocErr.response?.data || assocErr.message
        );
      }

      contactSummaries.push({
        id: contactId,
        name: `${props.firstname || ''} ${props.lastname || ''}`.trim() || props.email,
        email: props.email,
        phone: props.phone,
        address: props.address,
        city: props.city,
        state: props.state,
        country: props.country,
        createdate: props.createdate,
        deals
      });
    }

    const totalContacts = contactSummaries.length;
    const allDeals = contactSummaries.flatMap(c => c.deals || []);
    const totalDeals = allDeals.length;
    const totalDealValue = allDeals.reduce((sum, d) => {
      const v = parseFloat(d.amount || '0');
      return sum + (isNaN(v) ? 0 : v);
    }, 0);

    // Fallback if no Gemini key
    if (!GEMINI_API_KEY) {
      const fallback = [
        'AI Overview (fallback – GEMINI_API_KEY not configured)',
        '',
        `Most recent contacts examined: ${totalContacts}`,
        `Total associated deals: ${totalDeals}`,
        `Approx total deal value: $${totalDealValue.toFixed(2)}`,
        '',
        'Add GEMINI_API_KEY to .env to enable full Gemini-powered narrative insights.'
      ].join('\n');

      return res.json({ insights: fallback });
    }

    // 3) Build prompt
    const prompt = `
You are an assistant helping a sales/CS manager understand the most recent CRM activity.

You are given:
- The most recent ${totalContacts} contacts (capped at ${contactLimit})
- Their key details (email, location)
- All deals associated with each of those contacts

Write a concise summary that includes:
- 2–3 key observations about the new contacts (who they are, where they are based)
- 2–3 insights about the deals: stages, value concentration, notable trends (e.g. many small deals vs a few large ones)
- 2–3 recommended next actions for the team (e.g. follow-up focus, upsell opportunities, regions to prioritize)

Keep it under ~250 words. Use a friendly, executive tone.

Here is the JSON data:

${JSON.stringify(contactSummaries, null, 2)}
`.trim();

    // 4) Call Gemini via REST v1
    const geminiResponse = await axios.post(
      'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent',
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ]
      },
      {
        params: { key: GEMINI_API_KEY },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const candidate = geminiResponse.data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const aiText =
      parts.map(p => p.text || '').join('\n').trim() ||
      'No AI insights returned.';

    res.json({ insights: aiText });
  } catch (error) {
    console.error('Gemini AI overview error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to generate Gemini AI overview',
      details: error.response?.data || error.message
    });
  }
});


// ==============================
// START SERVER & SHUTDOWN HANDLERS
// ==============================
const server = app.listen(PORT, () => {
  console.log('\n✅ Server running successfully!');
  console.log(`🌐 API available at: http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`📁 Static files served from: /public`);
  console.log('\n🧠 AI overview: POST /api/ai/overview (uses Gemini if configured)\n');
});

const gracefulShutdown = (signal) => {
  console.log(`\n⚠️  Received ${signal}, closing server gracefully...`);

  server.close(() => {
    console.log('✅ Server closed successfully');
    console.log('👋 Goodbye!\n');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});
