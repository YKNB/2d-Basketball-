/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  computed,
  viewChild,
} from '@angular/core';
import { GeminiService } from './gemini.service';

// --- GAME CONSTANTS ---
const GRAVITY = 0.4;
const BOUNCE_DAMPENING = 0.7;
const AIM_POWER_FACTOR = 0.15;
const MAX_AIM_POWER = 120;

interface ConfettiPiece {
  id: number;
  left: string;
  top: string;
  color: string;
  animationDelay: string;
  animationDuration: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-screen h-screen',
    '(window:keydown)': 'onKeyDown($event)',
  },
})
export class AppComponent {
  private readonly geminiService = inject(GeminiService);

  // --- DOM ELEMENTS ---
  ballRef = viewChild<ElementRef<HTMLDivElement>>('ball');

  // --- GAME CONFIG (could be inputs) ---
  readonly BALL_RADIUS = 20;
  readonly COURT_PADDING = 10;
  readonly HOOP_POS = { x: 100, y: 200 }; // Position from top-right
  readonly BACKBOARD = { width: 6, height: 100 };
  readonly RIM = { width: 60, height: 20 }; // Note: Rim is a semicircle, height is for visual effect
  readonly RIM_Y_POS = () => this.HOOP_POS.y + this.BACKBOARD.height / 2;
  readonly RIM_X_START = () => window.innerWidth - this.HOOP_POS.x - this.RIM.width;
  readonly RIM_X_END = () => window.innerWidth - this.HOOP_POS.x;
  readonly BACKBOARD_X = () => window.innerWidth - this.HOOP_POS.x;

  // --- GAME STATE SIGNALS ---
  gameState = signal<'positioning' | 'ready' | 'aiming' | 'shooting' | 'scored' | 'missed'>('positioning');
  score = signal(0);
  shots = signal(0);
  stagedVelocity = signal<{ x: number; y: number } | null>(null);

  // --- BALL PHYSICS SIGNALS ---
  ballPosition = signal({ x: 150, y: window.innerHeight - 150 });
  ballVelocity = signal({ x: 0, y: 0 });

  // --- AIMING STATE SIGNALS ---
  private aimStartPos = signal<{ x: number; y: number } | null>(null);
  private aimCurrentPos = signal<{ x: number; y: number } | null>(null);

  // --- GEMINI-RELATED SIGNALS ---
  geminiMessage = signal('');
  isLoadingGemini = signal(false);

  // --- UI ENHANCEMENT SIGNALS ---
  animateScore = signal(false);
  animateNet = signal(false);
  confettiPieces = signal<ConfettiPiece[]>([]);

  // --- COMPUTED SIGNALS FOR THE TEMPLATE ---
  isAiming = computed(() => this.gameState() === 'aiming');
  ballTransform = computed(() => `translate(${this.ballPosition().x - this.BALL_RADIUS}px, ${this.ballPosition().y - this.BALL_RADIUS}px)`);
  
  ballShadowTransform = computed(() => {
    const yPercent = (this.ballPosition().y / window.innerHeight);
    const scale = 1.2 - yPercent * 0.6; // Shadow gets smaller as it goes up
    return `translateX(${this.ballPosition().x - this.BALL_RADIUS}px) scale(${scale})`;
  });

  ballShadowOpacity = computed(() => {
    const yPercent = (this.ballPosition().y / window.innerHeight);
    return Math.max(0, 0.4 - yPercent * 0.4); // Fades as it goes up
  });

  aimLine = computed(() => {
    const start = this.aimStartPos();
    const current = this.aimCurrentPos();
    const ballPos = this.ballPosition();
    
    // Draw line while actively aiming
    if (this.isAiming() && start && current) {
      const dx = start.x - current.x;
      const dy = start.y - current.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      dist = Math.min(dist, MAX_AIM_POWER);
      const angle = Math.atan2(dy, dx);

      return {
        x1: ballPos.x,
        y1: ballPos.y,
        x2: ballPos.x - dist * Math.cos(angle),
        y2: ballPos.y - dist * Math.sin(angle),
      };
    }
    
    // Draw line from staged velocity when ready to shoot
    const staged = this.stagedVelocity();
    if (this.gameState() === 'ready' && staged) {
      const power = Math.sqrt(staged.x**2 + staged.y**2) / AIM_POWER_FACTOR;
      const angle = Math.atan2(staged.y, staged.x);
       return {
         x1: ballPos.x,
         y1: ballPos.y,
         x2: ballPos.x + power * Math.cos(angle),
         y2: ballPos.y + power * Math.sin(angle),
       };
    }
    
    return null;
  });

  // --- GAME LOOP & STATE ---
  private animationFrameId: number | null = null;
  private wasAboveRim = false;

  // --- INPUT HANDLERS ---
  onKeyDown(event: KeyboardEvent) {
    if (this.gameState() === 'positioning') {
      const pos = { ...this.ballPosition() };
      const moveSpeed = 10;
      switch (event.key) {
        case 'ArrowUp': pos.y -= moveSpeed; break;
        case 'ArrowDown': pos.y += moveSpeed; break;
        case 'ArrowLeft': pos.x -= moveSpeed; break;
        case 'ArrowRight': pos.x += moveSpeed; break;
      }
      // Constrain position
      const constrainedX = Math.max(this.BALL_RADIUS, Math.min(pos.x, window.innerWidth / 2 - this.BALL_RADIUS));
      const constrainedY = Math.max(this.BALL_RADIUS, Math.min(pos.y, window.innerHeight - this.BALL_RADIUS));
      this.ballPosition.set({ x: constrainedX, y: constrainedY });
    } else if (this.gameState() === 'ready' && (event.key.toLowerCase() === 'x' || event.key.toLowerCase() === 'c')) {
      this.fireShot();
    }
  }
  
  onPointerDown(event: MouseEvent | TouchEvent) {
    if (this.gameState() === 'positioning' || this.gameState() === 'ready') {
      this.stagedVelocity.set(null); // Clear any previously staged shot
      this.onAimStart(event);
    }
  }

  onPointerMove(event: MouseEvent | TouchEvent) {
    if (this.isAiming()) {
      this.onAiming(event);
    }
  }

  onPointerUp(event: MouseEvent | TouchEvent) {
    if (this.isAiming()) {
      this.onAimEnd(event);
    }
  }

  onAimStart(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.gameState.set('aiming');
    const pos = this.getClientPos(event);
    this.aimStartPos.set(pos);
    this.aimCurrentPos.set(pos);
  }

  onAiming(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.aimCurrentPos.set(this.getClientPos(event));
  }

  onAimEnd(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    
    const start = this.aimStartPos()!;
    const end = this.aimCurrentPos()!;
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) { // If user just clicks without dragging
        this.gameState.set('ready');
        return;
    }
    
    if(dist > MAX_AIM_POWER) {
      const ratio = MAX_AIM_POWER / dist;
      dx *= ratio;
      dy *= ratio;
    }
    
    // STAGE the shot instead of firing
    this.stagedVelocity.set({
      x: dx * AIM_POWER_FACTOR,
      y: dy * AIM_POWER_FACTOR,
    });
    this.gameState.set('ready');
  }

  fireShot() {
    const velocity = this.stagedVelocity();
    if (!velocity) return;
    
    this.shots.update((s) => s + 1);
    this.ballVelocity.set(velocity);
    this.stagedVelocity.set(null);
    this.gameState.set('shooting');
    
    this.aimStartPos.set(null);
    this.aimCurrentPos.set(null);
    this.wasAboveRim = false;
    this.startGameLoop();
  }

  // --- GAME LOGIC ---
  private startGameLoop() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    const loop = () => {
      this.updateGameState();
      if (this.gameState() === 'shooting') {
        this.animationFrameId = requestAnimationFrame(loop);
      }
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private updateGameState() {
    const pos = { ...this.ballPosition() };
    const vel = { ...this.ballVelocity() };
    vel.y += GRAVITY;
    pos.x += vel.x;
    pos.y += vel.y;
    
    const courtWidth = window.innerWidth;
    const courtHeight = window.innerHeight;

    if (pos.y + this.BALL_RADIUS > courtHeight) {
      pos.y = courtHeight - this.BALL_RADIUS;
      vel.y *= -BOUNCE_DAMPENING;
      vel.x *= BOUNCE_DAMPENING;
    }
    if (pos.x + this.BALL_RADIUS > courtWidth || pos.x - this.BALL_RADIUS < 0) {
      vel.x *= -1;
      pos.x = pos.x - this.BALL_RADIUS < 0 ? this.BALL_RADIUS : courtWidth - this.BALL_RADIUS;
    }

    const isMovingDown = vel.y > 0;
    if (pos.y < this.RIM_Y_POS()) this.wasAboveRim = true;

    if (
      this.wasAboveRim && isMovingDown &&
      pos.y > this.RIM_Y_POS() && pos.y < this.RIM_Y_POS() + 20 &&
      pos.x > this.RIM_X_START() && pos.x < this.RIM_X_END()
    ) {
      this.handleScore();
      return;
    }

    if (
        pos.x + this.BALL_RADIUS > this.BACKBOARD_X() &&
        pos.y > this.HOOP_POS.y && pos.y < this.HOOP_POS.y + this.BACKBOARD.height
    ) {
        pos.x = this.BACKBOARD_X() - this.BALL_RADIUS;
        vel.x *= -BOUNCE_DAMPENING;
    }

    const distToRimFront = Math.hypot(pos.x - this.RIM_X_START(), pos.y - this.RIM_Y_POS());
    const distToRimBack = Math.hypot(pos.x - this.RIM_X_END(), pos.y - this.RIM_Y_POS());
    if (distToRimFront < this.BALL_RADIUS || distToRimBack < this.BALL_RADIUS) {
        vel.y *= -BOUNCE_DAMPENING;
        vel.x *= BOUNCE_DAMPENING;
    }

    if (pos.y > courtHeight + 100 || (Math.abs(vel.x) < 0.1 && Math.abs(vel.y) < 0.1 && pos.y > courtHeight - this.BALL_RADIUS - 1) ) {
        this.handleMiss();
        return;
    }

    this.ballPosition.set(pos);
    this.ballVelocity.set(vel);
  }

  private handleScore() {
    this.gameState.set('scored');
    this.score.update((s) => s + 1);
    this.fetchGeminiReaction(true);
    this.triggerAnimations();
  }

  private handleMiss() {
    this.gameState.set('missed');
    this.fetchGeminiReaction(false);
  }

  resetShot() {
    this.gameState.set('positioning');
    this.stagedVelocity.set(null);
    this.ballPosition.set({ x: 150, y: window.innerHeight - 150 });
    this.ballVelocity.set({ x: 0, y: 0 });
    this.geminiMessage.set('');
    this.confettiPieces.set([]);
  }

  // --- HELPER METHODS ---
  private async fetchGeminiReaction(didScore: boolean) {
    this.isLoadingGemini.set(true);
    this.geminiMessage.set('');
    try {
      const message = await this.geminiService.getShotReaction(didScore);
      this.geminiMessage.set(message);
    } catch (e) {
      console.error(e);
      this.geminiMessage.set('Oops, Gemini is taking a timeout.');
    } finally {
      this.isLoadingGemini.set(false);
    }
  }

  private getClientPos(event: MouseEvent | TouchEvent): { x: number; y: number } {
    if (event instanceof MouseEvent) {
      return { x: event.clientX, y: event.clientY };
    }
    const touch = event.touches[0] || event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }

  private triggerAnimations() {
    this.animateScore.set(true);
    setTimeout(() => this.animateScore.set(false), 300);
    this.animateNet.set(true);
    setTimeout(() => this.animateNet.set(false), 200);
    this.triggerConfetti();
  }

  private triggerConfetti() {
    const pieces: ConfettiPiece[] = [];
    const colors = ['#fde047', '#f97316', '#ef4444', '#ffffff'];
    for (let i = 0; i < 50; i++) {
      pieces.push({
        id: i,
        left: `${Math.random() * 100}vw`,
        top: `${-50 + Math.random() * -50}px`,
        color: colors[Math.floor(Math.random() * colors.length)],
        animationDelay: `${Math.random() * 0.5}s`,
        animationDuration: `${2 + Math.random() * 2}s`
      });
    }
    this.confettiPieces.set(pieces);
  }
}
