FROM denoland/deno:2.9.4

WORKDIR /app

# A self-signed cert for *.semsportal.com. It lets the container stand in for
# https://<region>.semsportal.com, which is where the SEMS client rewrites
# PowerStation calls when it logs in against a gateway API base.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

# A throwaway CA plus a leaf it signs. TLS stacks reject a self-signed CA
# presented as a server cert, so the two must be separate: clients trust
# /certs/ca.crt (DENO_CERT) and the server presents /certs/server.crt.
RUN mkdir -p /certs && cd /certs && \
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout ca.key -out ca.crt -subj "/CN=Fake SEMS Test CA" && \
    openssl req -nodes -newkey rsa:2048 -keyout server.key -out server.csr \
      -subj "/CN=fake-sems" && \
    printf 'subjectAltName=DNS:*.semsportal.com,DNS:semsportal.com,DNS:semsplus.goodwe.com,DNS:localhost,DNS:fake-sems,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > leaf.ext && \
    openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
      -out server.crt -days 3650 -extfile leaf.ext && \
    cat ca.crt >> server.crt && \
    chmod 644 server.key ca.crt server.crt

COPY deno.json ./
COPY src ./src
COPY smoke.ts ./

RUN deno check src/server.ts smoke.ts

EXPOSE 8099 443

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "src/server.ts"]
