import { NextRequest, NextResponse } from 'next/server';

// Cache the model at module level for reuse across requests
let textModelPromise: Promise<any> | null = null;
let tokenizerPromise: Promise<any> | null = null;

async function getTextModel() {
  if (!textModelPromise) {
    // Dynamic import to avoid issues with SSR
    const { CLIPTextModelWithProjection } = await import('@xenova/transformers');
    textModelPromise = CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32');
  }
  return textModelPromise;
}

async function getTokenizer() {
  if (!tokenizerPromise) {
    const { AutoTokenizer } = await import('@xenova/transformers');
    tokenizerPromise = AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
  }
  return tokenizerPromise;
}

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "text" field' },
        { status: 400 }
      );
    }

    // Load model and tokenizer (cached after first load)
    const [model, tokenizer] = await Promise.all([
      getTextModel(),
      getTokenizer(),
    ]);

    // Tokenize the text
    const textInputs = await tokenizer(text, {
      padding: true,
      truncation: true,
    });

    // Generate text embeddings
    const { text_embeds } = await model(textInputs);

    // L2 normalize the embedding (same as image embeddings)
    const raw = text_embeds.data as Float32Array;
    let sumSq = 0;
    for (let i = 0; i < raw.length; i++) {
      sumSq += raw[i] * raw[i];
    }
    const norm = Math.sqrt(sumSq);
    const embedding: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      embedding.push(raw[i] / norm);
    }

    return NextResponse.json({
      embedding,
      dimensions: embedding.length,
    });
  } catch (error) {
    console.error('CLIP embedding error:', error);
    return NextResponse.json(
      { error: 'Failed to generate embedding', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
