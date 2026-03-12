# Kubernetes Terminal - Demo Script

Commands to speak into the microphone to show off the STT-driven terminal.

## Cluster overview

- `kubectl get nodes`
- `kubectl get namespaces`

## Explore pods

- `kubectl get pods`
- `kubectl get pods -n kube-system`
- `kubectl get pods -n app`
- `kubectl get pods -n monitoring`

## Investigate issues

- `kubectl describe pod api-server -n default`
- `kubectl logs api-server -n default`
- `kubectl describe pod worker -n app`

## Services and deployments

- `kubectl get services`
- `kubectl get deployments`
- `kubectl get deployments -n app`

## Resource usage

- `kubectl top pods`
- `kubectl top pods -n app`

## Cluster context

- `kubectl config current-context`
- `kubectl config get-contexts`

## Remediation

- `kubectl rollout restart deployment api-server`
- `kubectl delete pod api-server -n default`
- `kubectl apply -f manifests`

## Shell commands

- `clear`
- `whoami`
- `hostname`
- `pwd`
- `ls`
- `cat notes.txt`
- `date`
- `help`
