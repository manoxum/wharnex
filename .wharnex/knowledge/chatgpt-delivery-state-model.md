# Estado de entrega ChatGPT: separar transporte, supervisão e ingestão

- A confirmação de `submitChatGPTDraft()` é o ponto de commit do transporte remoto. Depois dela, o request deve permanecer `submitted/awaiting_response`; falhas de URL, persistência de afinidade ou scheduler são falhas pós-submit de supervisão, não prova de que a entrega falhou.
- `failedPromptDeliveries` hoje mistura falhas outbound, falhas pós-submit e falhas inbound de ingestão. O estado de UI deve transportar fase/direção/disposição estruturadas, em vez de classificar apenas strings de erro.
- Só uma falha comprovadamente anterior à confirmação do submit é `safe_to_resend`. Falha de ingestão deve reprocessar o bundle preservado e nunca reenviar o prompt.
- Antes de qualquer resend, o Desktop deve verificar se o mesmo `request_id` já está em `expectedChatGPTBundles`; se estiver, a ação segura é continuar a supervisão/aguardar resposta. Uma entrada em `retryableChatGPTPrompts` não prova que o submit não ocorreu.
- O guard de sessão pendente no frontend é insuficiente para decidir segurança de resend: ele expressa estado do workflow Wharness, não o estado do transporte ChatGPT.
- `knowledge/index.json` v2 deve sair canonicamente apenas com `protocol`, `base_revision`, `mode` e `entries`; a ingestão pode tolerar somente o `request_id` histórico para recuperar bundles antigos sem transformar o parser num best-effort permissivo.
- Falha para persistir `remote_state` ou agendar `AWAIT_RESPONSE` depois do POST confirmado deve degradar para supervisão/atenção. Ela nunca transforma um write já aceito em `safe_to_resend`.
