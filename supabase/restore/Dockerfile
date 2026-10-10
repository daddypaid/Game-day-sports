# syntax=docker/dockerfile:1
# Small real PostgreSQL runtime; extensions are compiled from pinned official code.
FROM postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3
RUN --mount=type=secret,id=proxy_ca,required=true \
    set -eu; \
    apt-mark hold postgresql-17 postgresql-client-17; \
    apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca update; \
    apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca install -y --no-install-recommends \
      build-essential postgresql-server-dev-17 libcurl4-openssl-dev curl ca-certificates; \
    mkdir -p /tmp/pg_cron /tmp/pg_net; \
    curl --cacert /run/secrets/proxy_ca -fsSL https://api.github.com/repos/citusdata/pg_cron/tarball/9490f9cc9803f75105f2f7d89839a998f011f8d8 -o /tmp/pg_cron.tar.gz; \
    curl --cacert /run/secrets/proxy_ca -fsSL https://api.github.com/repos/supabase/pg_net/tarball/698fb055f666366a78c112b0578b0a5652ddbcfa -o /tmp/pg_net.tar.gz; \
    echo 'd6bccd1bb3ab7a357f8de798af487b6f4d7169def88883808aaec99375547a8c  /tmp/pg_cron.tar.gz' | sha256sum -c -; \
    echo 'ac76884dfbdd6f14136321f72f1dc11ac4ede2b78ebdd205c24c60f9e12c9961  /tmp/pg_net.tar.gz' | sha256sum -c -; \
    tar -xzf /tmp/pg_cron.tar.gz --strip-components=1 -C /tmp/pg_cron; \
    tar -xzf /tmp/pg_net.tar.gz --strip-components=1 -C /tmp/pg_net; \
    make -C /tmp/pg_cron -j2; make -C /tmp/pg_cron install; \
    make -C /tmp/pg_net -j2; make -C /tmp/pg_net install; \
    rm -rf /tmp/pg_cron /tmp/pg_net /tmp/*.tar.gz /var/lib/apt/lists/*
