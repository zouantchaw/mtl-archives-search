'use client';

import { useCallback, useRef, useState } from 'react';

// Singleton promises for model and tokenizer
let modelPromise: Promise<any> | null = null;
let tokenizerPromise: Promise<any> | null = null;

async function getModel() {
  if (!modelPromise) {
    const { CLIPTextModelWithProjection } = await import('@huggingface/transformers');
    modelPromise = CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', {
      device: 'wasm',
    });
  }
  return modelPromise;
}

async function getTokenizer() {
  if (!tokenizerPromise) {
    const { AutoTokenizer } = await import('@huggingface/transformers');
    tokenizerPromise = AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
  }
  return tokenizerPromise;
}

export function useClipEmbedding() {
  const [isLoading, setIsLoading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // Preload model (call this early to warm up)
  const preloadModel = useCallback(async () => {
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      try {
        await Promise.all([getModel(), getTokenizer()]);
        setIsModelReady(true);
      } catch (err) {
        console.error('Failed to preload CLIP model:', err);
        initPromiseRef.current = null;
      }
    })();

    return initPromiseRef.current;
  }, []);

  // Generate embedding for text
  const generateEmbedding = useCallback(async (text: string): Promise<number[] | null> => {
    setIsLoading(true);
    try {
      const [model, tokenizer] = await Promise.all([getModel(), getTokenizer()]);

      // Tokenize the text
      const textInputs = await tokenizer(text, {
        padding: true,
        truncation: true,
      });

      // Generate text embeddings
      const { text_embeds } = await model(textInputs);

      // L2 normalize the embedding
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

      setIsModelReady(true);
      return embedding;
    } catch (err) {
      console.error('CLIP embedding error:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    generateEmbedding,
    preloadModel,
    isLoading,
    isModelReady,
  };
}
