# Estado do conhecimento por chat

Novas sessões do Wharnex já são inicializadas no backend com `KnowledgeSharingEnabled=true`; o frontend trata apenas o valor explícito `false` como desligado. Isso preserva a regra de que cada novo chat começa com o conhecimento do projeto ativo, independentemente do estado de outro chat.

No composer, o botão **Conhecimento do projeto** deve comunicar o estado também dentro do próprio ícone: quando ativo, reutiliza o mesmo `artifact-dot` mostrado pelos seletores como **Contexto ZIP** e **Prompt**; quando desligado, esse marcador desaparece. Manter regressões nos testes do `ChatPanel` para os dois estados e no backend para a inicialização de novas sessões.
