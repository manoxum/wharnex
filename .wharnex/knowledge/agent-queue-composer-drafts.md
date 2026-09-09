# Fila de execução e rascunhos do composer

- A apresentação da fila do Agent deve ser derivada dos chats ainda ativos no projeto: entradas de chats arquivados não pertencem ao painel, mesmo que algum estado transitório antigo ainda exista no frontend.
- O painel FIFO é mais útil quando separa trabalho ativo, espera e histórico recente. O badge lateral conta apenas execuções ativas/pendentes; a lista pode preservar no máximo as cinco execuções terminadas mais recentes como contexto operacional.
- Estado de execução deve ser explícito por texto e semântica, usando cor apenas como reforço visual: `running/submitting`, `queued`, `completed` e `failed` precisam de labels e detalhes próprios.
- O texto/altura do ChatComposer pode continuar no `localStorage`, mas objetos `File` não são serializáveis de forma útil nesse mecanismo. Para sobreviver a remounts ao trocar de chat ou de área durante a mesma execução da app, os ficheiros anexados e referências de projeto devem ficar num rascunho efémero em memória, indexado por projeto + chat, e ser limpos ao enviar/limpar o composer.
- Regressões desta superfície devem cobrir tanto a seleção/limite da fila quanto a restauração de anexos ao desmontar e montar novamente o mesmo chat, além do isolamento entre chats.
