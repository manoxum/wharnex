FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /out/kernl ./cmd/harness

FROM docker:27-cli
RUN addgroup -g 10001 kernl && adduser -D -u 10001 -G kernl kernl
COPY --from=build /out/kernl /usr/local/bin/kernl
USER kernl
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kernl"]
