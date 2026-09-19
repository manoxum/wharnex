# Manutenção e aceitação da automação ChatGPT

Use este procedimento quando uma mudança da interface ChatGPT quebrar um Worker.

## Limites

- Trabalhe somente com operações nomeadas do Desktop e recursos temporários Wharnex.
- Não leia prosa do assistente, cookies, storage, credenciais, corpos/headers de rede ou DOM bruto.
- Scripts retornam somente estado e geometria estruturais; o processo principal faz o input confiável. Não acrescente clicks DOM para operações de conta.
- Pare em autenticação, CAPTCHA, acesso negado, gate estrutural ou rate limit. Não faça retries para “destravar”; o gate automático usa a duração configurada em **Políticas** (7 minutos e 30 segundos por padrão; limite de 1 a 60 minutos). Ao expirar, mantenha ambos os pools bloqueados: um único Worker deve recarregar sua URL confiável atual e só liberar a fila depois de confirmar estruturalmente `rateLimited=false`, sem gate de autenticação, verificação ou acesso. Novo 429/gate inicia outra suspensão configurada; página ambígua adia a confirmação sem consumir tentativa de tarefa.

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

### Mapa estrutural confirmado em 2026-09-19

- O histórico expõe `data-conversation-options-trigger`; o `data-testid` visual pode ser `history-item-<n>-options` ou `undefined-options` e não deve ser usado como identidade durável.
- O menu da conversa atualmente aberta expõe `button[data-testid="conversation-options-button"]`; use-o somente como fallback da conversa carregada.
- O botão do cabeçalho pode ter `aria-label="Mais"` e não declarar `aria-haspopup`; sua identidade vem do `data-testid`, não do texto localizado.
- Itens de ação expõem `data-testid` específicos; o `role="menuitem"` pode estar no mesmo nó ou num ancestral. Resolva primeiro o `data-testid`, suba apenas até o controle acionável e use labels localizados somente como fallback fechado.
- O popover de esforço pode expor o slider utilizável sem refletir `aria-expanded="true"` no gatilho. A presença de um único slider composer-scoped definido em `effortSlider` é a evidência de menu aberto; `aria-expanded` não é precondição.
- Um Worker oculto não pode depender de `webContents.sendInputEvent` para controles que exigem hit-testing. Localize e valide o retângulo no renderer e entregue o press confiável ao widget oculto pela operação estreita já implementada em `pressChatGPTControl`; nunca substitua isso por `HTMLElement.click()`.

Ao atualizar este mapa, incremente `CHATGPT_BEHAVIOR.revision`, acrescente uma regressão e remova toda instrumentação temporária marcada com `[DEBUG-...]` antes de concluir.
Todo gerador de script de conta deve entrar na lista `ALL_SCRIPTS` e passar pelo teste de compilação com `new Function`; regex dentro de template strings precisam preservar dupla fuga (`\\/`).

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

Se um 429 ocorrer durante a rodada, encerre a medição como inconclusiva. Confirme no estado durável que `paused_until` está à frente pela duração configurada, que nenhum pool reivindica trabalho novo durante a janela e que, ao expirar, exatamente um Worker recarrega a URL confiável e confirma a ausência estrutural do gate antes de qualquer pool voltar a reivindicar trabalho. Um novo 429 deve abrir outra janela completa. Só então verifique que o estado volta ao nível saudável antes de iniciar cinco casos novos.
