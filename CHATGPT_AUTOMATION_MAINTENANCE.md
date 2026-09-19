# Manutenção e aceitação da automação ChatGPT

Use este procedimento quando uma mudança da interface ChatGPT quebrar um Worker.

## Limites

- Trabalhe somente com operações nomeadas do Desktop e recursos temporários Wharnex.
- Não leia prosa do assistente, cookies, storage, credenciais, corpos/headers de rede ou DOM bruto.
- Scripts retornam somente estado e geometria estruturais; o processo principal faz o input confiável. Não acrescente clicks DOM para operações de conta.
- Pare em autenticação, CAPTCHA, acesso negado, gate estrutural ou rate limit. Não faça retries para “destravar”; o gate automático dura cinco minutos.

## Cadência

- Navegação, reload, upload, submit e operações de conta de qualquer Worker compartilham 30 s mínimos por perfil.
- `TRANSLATE_MARKDOWN` é a única exceção: 5 s mínimos.
- Supervisores não usam esse pacer; continuam sujeitos à pausa durável do provider.
- Observação passiva não é ação de provider e não consome tentativa/cadência.

## Investigação estrutural

1. Confirme que o provider não está pausado e que o chat de teste está ocioso.
2. Execute uma operação por vez e mantenha diagnóstico limitado a atributos, papéis, `data-testid`, visibilidade, estado disabled e URL sanitizada.
3. Compare com `services/desktop/chat-agent-behavior.mjs`, `chatgpt-dom.mjs`, `chatgpt-account.mjs` e `chat-agent-scripts.mjs`.
4. Escreva um teste de regressão de menor camada antes de mudar seletores/estados. Preserve validação estrita de artefato e a fronteira de conteúdo remoto.

## Aceitação por tipo

Para cada tipo habilitado (`RENAME_CHAT`, `ORGANIZE_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_TEMP_CHAT`, `DELETE_BUNDLE`, `TODO_CLASSIFY`, `TRANSLATE_MARKDOWN` e compatibilidades de título), crie cinco tarefas temporárias, isoladas e rastreáveis.

- Aceite somente com pelo menos 4/5 sucessos.
- Duas falhas do mesmo tipo suspendem a rodada daquele tipo: faça scraper estrutural dirigido, adicione regressão e repita cinco novas tarefas. Não use retry ilimitado.
- TODO e tradução só contam quando o arquivo de nome exato é baixado e aceito pelo validador do backend.
- Para operação destrutiva, crie antes o recurso temporário Wharnex que será removido; nunca use dado real como fixture.
- Registre apenas ID, tipo, estado, tentativas, timestamps, URL sanitizada e categoria de erro. Pausa do provider torna a rodada inconclusiva.

## Gates

```bash
cd services/desktop
node --test chat-agent-pacer.test.mjs chat-agent-scheduler.test.mjs chat-agent-residency.test.mjs main-regression.test.mjs
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Antes de aceitar, confira ausência de novo `429`, cumprimento da cadência e ausência de conteúdo remoto nos diagnósticos.
