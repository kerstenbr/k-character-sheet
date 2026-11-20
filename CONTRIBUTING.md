# Contribuindo com o K Character Sheet

Este guia reúne as orientações de desenvolvimento e os detalhes técnicos de operação. Para instalar e começar a usar, consulte o [README.md](README.md). Para orientações de manutenção por agentes, consulte o [AGENTS.md](AGENTS.md).

## Como contribuir

1. Descreva o problema ou a melhoria e mantenha a alteração focada nesse objetivo.
2. Prepare o ambiente local conforme a seção de desenvolvimento e testes.
3. Ao alterar comportamento, adicione ou ajuste os testes relevantes e execute `npm test` e `npm run build`.
4. No pull request, explique o que mudou, como foi validado e qualquer impacto sobre dados existentes.
5. Atualize a documentação afetada e não inclua fichas pessoais, backups ou segredos no repositório.

## Configuração e acesso

Com Docker e Compose instalados, use os comandos do README. No Windows, o Docker Desktop deve estar configurado para containers Linux.

Abra [http://localhost:3000](http://localhost:3000), ou a porta escolhida. Pela rede local, use `http://IP-DO-COMPUTADOR:PORTA`. Se necessário, permita a porta no firewall apenas para sua rede privada.

```dotenv
FRONTEND_PORT=3000
```

A aplicação aceita conexões pelo próprio computador e pela rede local automaticamente. Ela é pessoal, sem autenticação: qualquer dispositivo com acesso à porta pode acessar os dados. Não publique essa porta na internet.

Interface e API `/api` compartilham um único serviço e uma única porta. Por isso, não existe `BACKEND_PORT` separado nesta arquitetura. Não há URLs de API fixas no frontend. Depois de alterar a porta no `.env`, aplique com `docker compose up -d`; não é necessário recompilar a interface.

A primeira construção precisa de internet para baixar a imagem e as dependências. Depois disso, a aplicação funciona sem internet. Fontes, ícones, worker de PDF e recursos de renderização estão dentro da imagem. O computador que executa o Docker precisa permanecer ligado para acesso por outros computadores da rede.

## Limitações do editor de PDF

O aplicativo não executa JavaScript nem cálculos internos das fichas PDF. Campos de assinatura, botões de imagem, formulários XFA e PDFs protegidos não possuem edição especializada. Os tipos incompatíveis geram avisos; não há OCR nem alteração da diagramação original. O editor usa uma fonte local para o preenchimento; a aparência original dos campos não alterados é preservada na exportação.

## Dados e espaço em disco

O volume Docker `character_data` guarda o banco SQLite e os arquivos em `/app/data`. O nome efetivo recebe o prefixo do projeto Compose.

- Reiniciar ou recriar containers mantém os dados.
- `docker compose down` para a aplicação sem apagar o volume.
- **`docker compose down -v` apaga o volume e seus dados.**
- Histórico mantém no máximo 10 versões por recurso, além do estado atual. Salvamentos automáticos geram no máximo um ponto a cada 5 minutos; salvamentos manuais geram um ponto quando há alteração.
- PDFs e imagens são referenciados pelo histórico, não copiados a cada salvamento.
- Versões excedentes são excluídas. Arquivos deixam de existir no disco quando nenhuma ficha, modelo, registro na lixeira ou versão retida os utiliza.
- A lixeira mantém dados até exclusão definitiva. Use **Esvaziar lixeira** para liberar esse espaço.
- Uploads abandonados são removidos após 24 horas na próxima manutenção. A limpeza roda também após salvamentos; há manutenção periódica enquanto a aplicação está ligada.
- SQLite reutiliza páginas livres; o tamanho do arquivo pode não diminuir imediatamente após cada exclusão. O conteúdo excluído não permanece no histórico da aplicação.
- Rascunhos locais são apagados após o salvamento bem-sucedido; a recuperação pertence ao navegador em que a edição foi feita.

## Backup e restauração

Use o botão de exportação da campanha ou **Configurações → Exportar biblioteca**. O ZIP inclui originais, imagens, valores, quadros e conexões, diário, histórico retido e registros na lixeira. Preferências globais de aparência/salvamento não são incluídas; cada instalação tem suas próprias preferências. Preferências específicas das fichas são preservadas.

Em **Configurações → Restaurar backup**, selecione o ZIP. Os registros recebem novos identificadores e as campanhas recebem o sufixo “(restaurado)”, sem sobrescrever a biblioteca existente. O limite de importação é 200 MB comprimidos e 500 MB descomprimidos. Não há backup automático.

Para uma cópia integral do volume: pare a aplicação com `docker compose stop`, copie **todo** o conteúdo do volume (banco, eventuais arquivos WAL e pasta `files`) usando sua ferramenta de backup de volumes e reinicie com `docker compose start`. Restaure o volume com a aplicação parada. Uma cópia isolada do arquivo SQLite enquanto o app está ligado não é um backup integral consistente.

## Desenvolvimento e testes

Requisito local: Node.js 24 e npm.

```sh
npm ci
npm run build
npm start
```

`npm run dev` reinicia a API ao editar arquivos do servidor. A interface é servida a partir de `dist`; execute `npm run build` novamente após editar o frontend.

```sh
npm test
npm run build
```

Os testes usam bancos temporários, sem tocar nos dados da aplicação. Cobrem conflitos, retenção, restauração, coleta de arquivos, modelos, exportação de formulários, backup e coordenadas de páginas rotacionadas. Se existir `tmp/pdfs/example.pdf`, também validam esse PDF real; ele é ignorado pelo Git e pelo Docker.

Estrutura:

```text
src/       Interface React, editor de PDF e quadro
server/    API, SQLite, arquivos, exportação e backup
shared/    Tipos compartilhados
tests/     Testes de integração
```

## Exportação do quadro

O botão **Exportar PNG** renderiza notas, imagens e conexões localmente no navegador, incluindo edições ainda não salvas e itens fora da área visível. O arquivo usa o nome do quadro, as cores de fundo do quadro e dos contêineres de imagens do tema atual e margem ao redor do conteúdo; controles e seleção não aparecem. O texto parte do início de cada nota e fica limitado ao espaço dela: amplie notas com rolagem antes de exportar para mostrar mais texto.

A exportação usa Canvas, sem serviços externos ou novas dependências. A escala é de até 2×, reduzida automaticamente para limitar a imagem a 8192 pixels por lado e 16 milhões de pixels no total. Quadros muito extensos podem perder legibilidade nessa redução. Uma falha ao carregar imagens interrompe a exportação e mostra um erro, evitando gerar um arquivo incompleto. PNG foi escolhido por preservar a disposição livre do quadro, sem paginação.

## Preparação para compartilhar no GitHub

O `.gitignore` exclui `.env`, `data/`, `tmp/`, dependências e builds. PDFs pessoais, backups e dados do volume não fazem parte do código. Compartilhe o código e `.env.example`; cada pessoa cria seu próprio `.env` e seu volume local.

