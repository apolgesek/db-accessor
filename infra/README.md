Deploy the GitHub/CDK access stack once from local/admin credentials:

```powershell
.\cdk-deploy-to.bat 349036690903 eu-central-1 dev DbAccessorDeployAccessStack --profile apolgesek-dev --require-approval never
```

Deploy the app stack:

```powershell
.\cdk-deploy-to.bat 349036690903 eu-central-1 dev DbAccessorStack --profile apolgesek-dev --require-approval never
```
