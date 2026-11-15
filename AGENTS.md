# Orientações para agentes

## Projeto

K Character Sheet é uma aplicação local para organizar fichas de RPG, editar PDFs, manter quadros de notas e registrar diários de campanha. A interface é em português e independente de sistema de regras.

## Estrutura e arquitetura

- `src/`: interface React, editor de PDF, quadros e lógica de salvamento no navegador.
- `server/`: API Express, persistência SQLite, arquivos, exportação de PDFs e backup.
- `shared/`: tipos compartilhados entre interface e servidor.
- `tests/`: testes automatizados.
- `compose.yaml` e `Dockerfile`: execução e empacotamento com Node.js 24.

Interface e API `/api` são servidas pelo mesmo serviço e pela mesma porta. Mantenha as chamadas do frontend relativas a `/api`, sem URLs fixas ou uma porta separada para o backend. No Docker, `FRONTEND_PORT` configura a porta e os dados ficam em `/app/data`, no volume `character_data`.

## Cuidados ao alterar o código

- Preserve o funcionamento sem internet após a construção da imagem; fontes, ícones e recursos de PDF devem permanecer locais.
- Considere salvamento automático e manual, rascunhos de recuperação e conflitos entre abas ao alterar a edição ou persistência.
- Ao alterar armazenamento, considere referências a arquivos em fichas, modelos, lixeira e versões do histórico antes de remover arquivos.
- Preserve a restauração de backups como cópias independentes, sem sobrescrever registros existentes.
- Mantenha validações de entrada da API e tipos compartilhados coerentes com a interface.
- Não inclua `.env`, dados locais, PDFs pessoais, backups, dependências ou builds no Git.
- Preserve alterações locais que não pertençam à tarefa em andamento.

## Desenvolvimento e validação

Use Node.js 24 e npm. Execute `npm ci`, `npm run build` e `npm start` para preparar e iniciar a aplicação localmente. `npm run dev` observa o servidor; alterações no frontend exigem uma nova execução de `npm run build`.

Para alterações de código, execute `npm test` e `npm run build`. Os testes usam bancos temporários; não use dados pessoais para validação. Quando houver mudanças visuais ou de interação, confira também o fluxo afetado na interface. Para alterações apenas de documentação, confira comandos, links e consistência com o código, sem exigir testes da aplicação.

## Documentação

- `README.md`: apresentação breve, instalação com Docker e guia rápido de uso.
- `CONTRIBUTING.md`: contribuições, desenvolvimento, testes, configuração, limitações, armazenamento e backups.
- `AGENTS.md`: contexto e orientações para manutenção por agentes.

Mantenha o README simples. Registre detalhes técnicos em CONTRIBUTING.md e instruções para agentes neste arquivo.
