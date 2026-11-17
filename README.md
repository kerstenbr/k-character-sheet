# K Character Sheet

Uma biblioteca local de fichas de RPG, em português e independente de sistema de regras. 
![Tela Inicial](https://i.imgur.com/0Ijck4f.png)

Organize personagens por campanha, preencha PDFs, crie quadros de notas e registre suas sessões em um diário.
![Tela Inicial](https://i.imgur.com/jsHUVR1.png)
![Tela Inicial](https://i.imgur.com/50ipMLE.png)
![Tela Inicial](https://i.imgur.com/R3cQ6ZZ.png)
![Tela Inicial](https://i.imgur.com/59J1lWu.png)

A ferramenta inclui salvamento automático, modelos reutilizáveis, histórico de versões e backup da biblioteca. Depois da instalação, funciona sem internet.

## Por quê?

Eu fui convidado a participar de uma mesa de RPG do Cyberpunk Edgerunners e fiquei lutando para conseguir editar minha ficha no firefox e depois do edge, me perdi no meu bloco de notas e achei muito complicado fazer a gestão do meu personagem daquela maneira.
Achei mais fácil criar uma ferramenta que edita a ficha e ainda me permite fazer anotações.

## Como rodar

Você precisa do Docker com Compose instalado.

```sh
git clone https://github.com/kerstenbr/k-character-sheet.git
cd k-character-sheet
cp .env.example .env
docker compose up -d --build
```

Abra [http://localhost:3000](http://localhost:3000). Para usar outra porta, altere `FRONTEND_PORT` no `.env` antes de iniciar.

A aplicação é de uso pessoal e não tem autenticação.

## Guia rápido

1. Clique em **Nova campanha** para organizar seus personagens.
2. Use **Importar ficha** para adicionar um PDF. O arquivo original permanece intacto.
3. Em **Preencher**, edite os campos da ficha. Se o PDF não tiver campos, adicione-os em **Configurar campos**.
4. As alterações são salvas automaticamente por padrão. Use **Baixar PDF** para exportar uma cópia preenchida.
5. Organize notas e imagens no **Quadro** e registre as sessões no **Diário**.
6. Use **Histórico** para recuperar versões e **Salvar como modelo**, no menu da ficha, para reutilizar seus campos.
7. Em **Configurações**, use **Exportar biblioteca** e **Restaurar backup** para guardar ou recuperar uma cópia dos seus dados.

Para desenvolvimento, configuração e detalhes sobre dados e backups, consulte [CONTRIBUTING.md](CONTRIBUTING.md). As orientações para agentes estão em [AGENTS.md](AGENTS.md).
