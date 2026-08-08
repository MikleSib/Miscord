# Miscord Docs

Документация построена на Mintlify и находится в каталоге `docs` монорепозитория.

## Локальная проверка

```bash
cd docs
mint validate
mint broken-links --check-anchors --check-redirects
mint dev
```

## Настройка Mintlify

1. Подключить репозиторий `MikleSib/Miscord` и ветку `new-4`.
2. Указать каталог документации `docs`.
3. Добавить custom domain `docs.miscord.ru`.
4. В DNS создать `CNAME` с именем `docs` и значением `cname.mintlify.builders`.
5. Добавить CAA `0 issue "letsencrypt.org"`, если зона ограничивает центры сертификации.

Для `docs.miscord.ru` не требуется отдельный контейнер в production Compose: сборку и TLS обслуживает Mintlify.
