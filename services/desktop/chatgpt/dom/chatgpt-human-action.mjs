import { RATE_LIMIT_GATE_SELECTORS } from '../transport/recovery/chatgpt-rate-limit.mjs'
import { composerLookupSource, encode } from './chatgpt-composer-lookup.mjs'

// Structural detection of gates that need a person (verification,
// authentication, access) and of ChatGPT's own rate-limit affordance.
export function chatGPTHumanActionScript() {
  return `(() => {
    try {
    const path = String(location.pathname || '');
    const href = String(location.href || '');
    const title = String(document.title || '').trim().toLowerCase();
    const visible = (node) => { const rect = node?.getBoundingClientRect?.(); return Boolean(rect && rect.width > 0 && rect.height > 0); };
    const firstVisible = (selector) => [...document.querySelectorAll(selector)].find(visible);
    const challenge = Boolean(
      firstVisible('iframe[src*="challenges.cloudflare.com"],iframe[src*="/cdn-cgi/challenge-platform/"],iframe[src*="captcha" i],iframe[src*="arkoselabs" i],iframe[src*="funcaptcha" i],iframe[src*="hcaptcha.com" i],iframe[src*="recaptcha" i],input[name="cf-turnstile-response"],.cf-turnstile,.h-captcha,.g-recaptcha,#arkose,[data-testid*="captcha" i],[data-testid*="challenge" i]')
      || /\\/cdn-cgi\\/challenge-platform\\//i.test(href)
      || title === 'just a moment...'
      || title === 'security verification'
      || title === 'verify you are human'
      || title.startsWith('attention required')
    );
    // A signed-out or token-rejected session can stay on chatgpt.com and still
    // render a composer until the client gives up on the session; the visible
    // sign-in controls are the structural, language-neutral signal of that gate.
    const signInGate = Boolean(firstVisible('[data-testid="login-button"],[data-testid="signup-button"]'));
    const authentication = /^\\/auth(?:\\/|$)/i.test(path) || signInGate;
    const access = Boolean(firstVisible('[data-testid*="access-denied" i],[data-testid*="blocked" i],[data-testid*="unsupported-browser" i]'));
    // ChatGPT's own "too many requests" affordance. Structural selectors only,
    // so this reads the same in every interface language. It is deliberately
    // NOT a human-action kind: the account reopens on its own, so the answer is
    // a durable provider suspension, not a notification asking for a person.
    const rateLimited = Boolean(firstVisible(${encode(RATE_LIMIT_GATE_SELECTORS.join(','))}));
    ${composerLookupSource()}
    const kind = challenge ? 'verification' : authentication ? 'authentication' : access ? 'access' : '';
    return {
      required: Boolean(kind),
      kind,
      rateLimited,
      composerReady: Boolean(composer),
      pageVisible: document.visibilityState !== 'hidden',
      capturedAt: new Date().toISOString(),
    };
    } catch (_error) {
      return { required: false, kind: '', rateLimited: false, composerReady: false, pageVisible: false, capturedAt: new Date().toISOString() };
    }
  })()`
}
