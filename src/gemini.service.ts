/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Injectable, signal } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private error = signal<string | null>(null);

  constructor() {
    if (!process.env.API_KEY) {
      this.error.set(
        'API key not configured. Please set the API_KEY environment variable.'
      );
      return;
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async getShotReaction(didScore: boolean): Promise<string> {
    if (this.error() || !this.ai) {
      return this.error() ?? 'Gemini Service not initialized.';
    }

    const prompt = didScore
      ? 'Generate a short, hype, and creative compliment for someone who just scored a basket. Be like a cool sports commentator. Max 15 words.'
      : 'Generate a short, funny, and slightly teasing "trash talk" comment for someone who just missed a basketball shot. Keep it lighthearted. Max 15 words.';

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      return response.text;
    } catch (e) {
      console.error(e);
      throw new Error('Failed to get a reaction from Gemini.');
    }
  }
}
