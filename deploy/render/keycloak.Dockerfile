# Keycloak for the bundled sign-in (served under PUBLIC_URL/auth by the web service). The realm is imported on first
# start; keycloak-setup.sh then applies this deployment's URL, client secret and passwords on every start.
FROM keycloak/keycloak:26.8.1
COPY infra/local/keycloak/tributary-realm.json /opt/keycloak/data/import/tributary-realm.json
COPY deploy/render/keycloak-start.sh deploy/render/keycloak-setup.sh /opt/keycloak/bin/
ENV KC_DB=postgres KC_HTTP_ENABLED=true KC_HTTP_PORT=8080 KC_HTTP_RELATIVE_PATH=/auth \
    KC_PROXY_HEADERS=xforwarded KC_HEALTH_ENABLED=true
EXPOSE 8080
ENTRYPOINT ["/bin/bash", "/opt/keycloak/bin/keycloak-start.sh"]
