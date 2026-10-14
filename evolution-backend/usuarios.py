from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
import auth
from database import get_db

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])

@router.post("/", response_model=schemas.UsuarioResponse)
def create_usuario(usuario: schemas.UsuarioCreate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    if current_user.perfil != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para crear usuarios")
    
    # Check if user exists
    db_user = db.query(models.Usuario).filter(models.Usuario.usuario == usuario.usuario).first()
    if db_user:
        raise HTTPException(status_code=400, detail="El nombre de usuario ya está registrado")
        
    hashed_password = auth.get_password_hash(usuario.password)
    db_usuario = models.Usuario(
        usuario=usuario.usuario,
        nombre=usuario.nombre,
        perfil=usuario.perfil,
        hashed_password=hashed_password,
        id_agente=usuario.id_agente
    )
    db.add(db_usuario)
    try:
        db.commit()
        db.refresh(db_usuario)
        return db_usuario
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/", response_model=List[schemas.UsuarioResponse])
def read_usuarios(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    if current_user.perfil != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para ver los usuarios")
    usuarios = db.query(models.Usuario).offset(skip).limit(limit).all()
    return usuarios

@router.get("/{id}", response_model=schemas.UsuarioResponse)
def read_usuario(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    if current_user.perfil != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos")
    usuario = db.query(models.Usuario).filter(models.Usuario.id == id).first()
    if usuario is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return usuario

@router.put("/{id}", response_model=schemas.UsuarioResponse)
def update_usuario(id: int, usuario_update: schemas.UsuarioUpdate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    if current_user.perfil != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para modificar usuarios")
        
    db_usuario = db.query(models.Usuario).filter(models.Usuario.id == id).first()
    if db_usuario is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    update_data = usuario_update.model_dump(exclude_unset=True)
    if "password" in update_data:
        db_usuario.hashed_password = auth.get_password_hash(update_data["password"])
        del update_data["password"]
        
    for key, value in update_data.items():
        setattr(db_usuario, key, value)
        
    try:
        db.commit()
        db.refresh(db_usuario)
        return db_usuario
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{id}")
def delete_usuario(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    if current_user.perfil != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para eliminar usuarios")
        
    db_usuario = db.query(models.Usuario).filter(models.Usuario.id == id).first()
    if db_usuario is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    db.delete(db_usuario)
    db.commit()
    return {"message": "Usuario eliminado correctamente"}
