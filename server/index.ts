import "dotenv/config";
import { createApp } from "./app";
const port = Number(process.env.PORT || process.env.FRONTEND_PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("A porta deve ser um inteiro de 1 a 65535.");
const { app, close } = createApp(process.env.DATA_DIR || "data");
const server = app.listen(port, "0.0.0.0", () => console.log(`K Character Sheet: http://localhost:${port}`));
server.on("error", (e: any) => {
  console.error(e.code === "EADDRINUSE" ? `Porta ${port} ocupada. Altere FRONTEND_PORT no .env.` : e);
  process.exit(1);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      close();
      process.exit(0);
    }),
  );
