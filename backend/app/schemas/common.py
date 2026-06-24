from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

DataT = TypeVar("DataT")


class SuccessResponse(BaseModel, Generic[DataT]):
    success: Literal[True] = True
    data: DataT


class ErrorResponse(BaseModel):
    success: Literal[False] = False
    error: str
