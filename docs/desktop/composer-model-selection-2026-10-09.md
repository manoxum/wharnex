# Modelos do composer — 2026-10-09

O controlo de modelos recebe as opções do menu estrutural do ChatGPT associado
àquele chat. Não há catálogo fixo nem leitura da resposta do assistente. A UI
consulta apenas por gesto humano; a operação nomeada aloca o Supervisor normal
quando necessário e inicializa somente uma superfície em branco, no home ou na
URL canónica já ligada ao chat. Uma conversa carregada nunca é retargetada por
este controlo.

Os IPCs `getChatGPTModels({workspaceChatId,url?})` e
`setChatGPTModel({workspaceChatId,url?,model})` retornam
`{ok,current,options:[{id,label,disabled}]}`. O main autentica a janela,
valida ownership/origem, serializa com preparação e recusa geração, espera de
bundle, entrega pendente, drafts/comentários, autenticação e modo Manual.
O script enumera no máximo 32 opções com identidade/etiqueta de 120 caracteres,
resolve o índice novamente e retorna geometria; o main envia input nativo.
Identidade duplicada, opção desativada, controlo ambíguo ou seleção não
confirmada deixam a operação fechada. Sem controlo identificado não há Escape
ou qualquer input nativo.

A preferência confirmada vive em `wharnex-chat-models-v1.json` sob userData,
com escrita atómica, permissões privadas e limite de 512 chats. É configuração
local, sem acesso ao browser storage. O preflight antes do upload pode aplicar
esta preferência; o pre-submit somente confirma a mesma seleção. O esforço
solicitado continua obrigatório e independente. Um modelo sem esse esforço
não autoriza redução silenciosa nem reenvio. Sem preferência, o comportamento
anterior é preservado. Adoção de pedidos já enviados permanece passiva.

O probe fechado `model-picker` não abre menus: observa apenas o popup ligado
por `aria-controls`, contagens e etiquetas/selected/disabled limitadas. Mantém
o gating de desenvolvimento existente e não expõe DOM bruto.

Testes cobrem inventário dinâmico, exclusão de descrições, identidade alterada
entre inventário e click, escolhas desativadas/duplicadas, input em Supervisor
oculto com restauração, guardas de request e login, persistência por chat,
primeira abertura de chat e pre-submit sem mudança. Os testes existentes de
esforço e de proibição de prosa continuam intactos. Revisão de refactoring:
helper de input scoped extraído e reutilizado; domínio models por entry point;
nenhum novo ficheiro excede 200 linhas ou domínio excede 20 ficheiros.

Aceitação com a página real ainda requer rollout coordenado e gesto humano de
abrir/escolher um modelo. Testes simulados não comprovam o inventário que a
conta oferece atualmente. Uma estrutura de menu desconhecida falha fechado e
pode ser medida pelo probe; nomes de modelos nunca serão uma correção estática.

Validação final: `npm run build` Desktop **1074/1074**;
36 testes focados de modelos/submit/effort/probe antes do gate completo;
`git diff --check` e `WHARNEX_DOMAIN_LAYOUT_BASE=HEAD` passam.
A regressão de popup anexo foi observada red e ficou green ao exigir
etiqueta de controlo conhecida no fallback; nomes do catálogo permanecem dinâmicos.
