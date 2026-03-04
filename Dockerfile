FROM denoland/deno:2.2.2 AS build

WORKDIR /app
COPY . .

RUN deno compile \
  --allow-all \
  --unstable-worker-options \
  --target x86_64-unknown-linux-gnu \
  --output /app/server \
  server/main.ts

FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=build /app/server /server

EXPOSE 8080

ENTRYPOINT ["/server"]
