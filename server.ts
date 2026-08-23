import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize server-side Gemini client with proper User-Agent header
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// In-memory store for consultation inquiries (also backed by client local persistence)
const consultationInquiries: any[] = [];

// 1. Health check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'WebMint Digital Platform', timestamp: new Date().toISOString() });
});

// 2. Consultation Inquiry Submission API
app.post('/api/consultation-inquiry', (req, res) => {
  try {
    const inquiry = {
      id: `inq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      receivedAt: new Date().toISOString(),
      ...req.body,
    };

    consultationInquiries.push(inquiry);
    console.log(`[WebMint] New consultation inquiry received from: ${inquiry.name} (${inquiry.businessName}) - Help: ${inquiry.helpNeeded}`);

    res.status(200).json({
      success: true,
      message: 'Consultation inquiry received successfully.',
      inquiryId: inquiry.id,
    });
  } catch (error: any) {
    console.error('[WebMint] Error logging inquiry:', error);
    res.status(500).json({ success: false, error: 'Failed to record inquiry' });
  }
});

// 3. AI Digital Plan Analyzer (using gemini-3.1-pro-preview with thinkingLevel HIGH)
app.post('/api/analyze-digital-plan', async (req, res) => {
  try {
    const { businessName, businessType, currentHelpNeeded, businessGoal, currentWebsite } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      // Return structured fallback if API key is not configured in local environment
      return res.status(200).json({
        recommendation: currentHelpNeeded === 'Not sure yet' ? 'Website' : currentHelpNeeded,
        summary: `For ${businessName || 'your business'} (${businessType || 'business'}), establishing a clean, fast mobile web presence and a direct lead capture flow is the most effective initial focus.`,
        keyInsights: [
          'High mobile responsiveness is essential for local customer trust',
          'A frictionless contact trigger (WhatsApp/Form) prevents lead drop-off',
          'Avoid heavy templates with unnecessary monthly plugin costs',
        ],
        suggestedSteps: [
          '25-min scope & workflow discovery review',
          'Map out the primary customer action and enquiry routing',
          'Select the appropriate starting tier (Starter ₹11.5k or Growth ₹17.5k)',
        ],
        whyThisFits: 'Directly addresses customer trust without overcomplicating initial operations.',
        avoidPitfalls: [
          'Do not purchase unneeded enterprise software licenses',
          'Avoid generic commodity agency templates',
        ],
      });
    }

    const ai = getAiClient();

    const prompt = `You are the lead technical and digital systems architect at WebMint, a modern digital agency in India.
WebMint helps businesses understand what they actually need—a high-quality website, workflow automation, or both—and then builds it with honesty and zero technical jargon.

Analyze the prospective client's business context:
- Business Name: ${businessName || 'Undisclosed'}
- Business Type: ${businessType || 'General Business'}
- Client's current thought: ${currentHelpNeeded || 'Not sure yet'}
- Business Goals & Challenges: "${businessGoal || 'Not specified'}"
- Current Website / Social: ${currentWebsite || 'None provided'}

Provide an objective, non-pushy, highly tailored recommendation. If they only need a simple website, say Website. If they are wasting hours on manual tasks and already have traffic, recommend Automation. If both apply, recommend Both. If their goals are unclear, recommend 'Start with Foundational Consultation'.

Respond in strict JSON matching the schema.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendation: {
              type: Type.STRING,
              description: "Must be one of: 'Website', 'Automation', 'Both', or 'Start with Foundational Consultation'",
            },
            summary: {
              type: Type.STRING,
              description: 'A 2-sentence candid assessment of their digital needs.',
            },
            keyInsights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 bullet points analyzing their biggest leverage points.',
            },
            suggestedSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 recommended steps for their upcoming consultation call.',
            },
            whyThisFits: {
              type: Type.STRING,
              description: 'Why this recommendation avoids wasteful spending.',
            },
            avoidPitfalls: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2 common pitfalls they should steer clear of.',
            },
          },
          required: ['recommendation', 'summary', 'keyInsights', 'suggestedSteps', 'whyThisFits', 'avoidPitfalls'],
        },
      },
    });

    const outputText = response.text;
    if (!outputText) {
      throw new Error('No text returned from Gemini model');
    }

    const parsed = JSON.parse(outputText);
    res.status(200).json(parsed);
  } catch (error: any) {
    console.error('[WebMint] Error running Gemini digital plan analysis:', error);
    // Graceful fallback response
    res.status(200).json({
      recommendation: req.body.currentHelpNeeded === 'Not sure yet' ? 'Start with Foundational Consultation' : req.body.currentHelpNeeded || 'Website',
      summary: `Tailored plan ready for discussion during your consultation call.`,
      keyInsights: [
        'Prioritize high-trust mobile responsiveness for local discovery',
        'Capture customer inquiries with zero friction (direct WhatsApp or smart form)',
        'Avoid heavy templates that slow down mobile customer evaluations',
      ],
      suggestedSteps: [
        'Review current inquiry flow on 25-min call',
        'Assess whether manual lead handling is the bottleneck',
        'Determine exact package scope upfront',
      ],
      whyThisFits: 'Ensures you spend only on what produces immediate clarity and operational relief.',
      avoidPitfalls: [
        'Do not pay for expensive unneeded software licenses',
        'Avoid generic templates that look identical to competitors',
      ],
    });
  }
});

// Vite middleware & Static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WebMint server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
