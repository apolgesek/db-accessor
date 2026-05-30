Deploy CDK toolkit:

```powershell
cdk bootstrap aws://349036690903/eu-central-1 --profile apolgesek-dev
```

Deploy the GitHub/CDK access stack once from local/admin credentials:

```powershell
.\cdk-deploy-to.bat 349036690903 eu-central-1 dev db-accessor-deploy-stack --profile apolgesek-dev --require-approval never
```

Deploy the app stack:

```powershell
.\cdk-deploy-to.bat 349036690903 eu-central-1 dev DbAccessorStack --profile apolgesek-dev --require-approval never
```
